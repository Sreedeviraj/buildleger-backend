import { z } from 'zod';
import { prisma } from '../../db.js';
import type { Attachment, Expense } from '../../generated/prisma/client.js';
import { ExpenseCategory, PaymentMode } from '../../generated/prisma/enums.js';
import { diff, formatINR, recordAudit } from '../../lib/audit.js';
import { fromDateOnly, toDateOnly } from '../../lib/dates.js';
import { AppError, DuplicateError, NotFoundError } from '../../lib/errors.js';
import {
  attachmentChange,
  attachmentsInput,
  optionalId,
  pastDate,
  syncAttachments,
  toAttachment,
  voidedOf,
  withAttachments,
} from '../../lib/money.js';
import { amount, requiredText } from '../../lib/validation.js';
import type { AuthContext } from '../../middleware/auth.js';
import { paidOnBill } from '../bills/bills.service.js';

// ---- Input rules ----

const fields = {
  projectId: requiredText('Please choose a project.'),
  amount: amount('an amount'),
  date: pastDate('payment date'),
  category: z.enum(ExpenseCategory, { error: 'Please choose a valid category.' }),
  supplierId: optionalId,
  /** Set when this expense pays (part of) a supplier bill. */
  billId: optionalId,
  /** Payee name when no supplier is chosen (e.g. "Panchayat office"). */
  paidTo: z.string().trim().default(''),
  mode: z.enum(PaymentMode, { error: 'Please choose a valid payment method.' }),
  invoiceRef: z.string().trim().default(''),
  note: z.string().trim().default(''),
  attachments: attachmentsInput,
  /** The user saw the "already saved" warning and chose to save anyway. */
  allowDuplicate: z.boolean().default(false),
};

export const expenseInput = z.object({ ...fields, requestId: z.string().max(100).optional() });
export type ExpenseInput = z.infer<typeof expenseInput>;

export const expenseUpdate = z.object({ ...fields, reason: z.string().trim().default('') });
export type ExpenseUpdate = z.infer<typeof expenseUpdate>;

export const voidInput = z.object({ reason: requiredText('Please give a reason for voiding.') });

const HISTORY_FIELDS = ['amount', 'date', 'category', 'supplierId', 'billId', 'paidTo', 'mode', 'invoiceRef', 'note'] as const;

type Fields = z.infer<z.ZodObject<typeof fields>>;

// ---- Shape sent to the frontend (same as Expense in frontend/src/types.ts) ----

function toExpense(e: Expense & { attachments: Attachment[] }) {
  const { voidedAt, voidedByName, voidReason, requestId: _requestId, ...rest } = e;
  return {
    ...rest,
    date: fromDateOnly(e.date),
    attachments: e.attachments.map(toAttachment),
    voided: voidedOf({ voidedAt, voidedByName, voidReason }),
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

/** Only this company's expense; another company's id looks exactly like a missing one. */
async function findOwn(companyId: string, id: string) {
  const expense = await prisma.expense.findFirst({ where: { id, companyId }, include: withAttachments });
  if (!expense) throw new NotFoundError('Expense');
  return expense;
}

/**
 * Checks shared by add and edit, and returns what to save.
 * An expense that pays a bill always takes the bill's supplier and category.
 * `editingId` leaves the expense being edited out of the totals.
 */
async function prepare(companyId: string, input: Fields, editingId?: string) {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, companyId }, select: { id: true } });
  if (!project) throw new NotFoundError('Project');

  let { supplierId, category } = input;
  if (input.billId) {
    const bill = await prisma.bill.findFirst({ where: { id: input.billId, companyId } });
    if (!bill) throw new NotFoundError('Bill');
    if (bill.voidedAt) throw new AppError(400, 'This bill has been voided. Choose another bill.');
    if (bill.projectId !== input.projectId) throw new AppError(400, 'This bill belongs to a different project.');
    const due = bill.amount - (await paidOnBill(bill.id, editingId));
    if (input.amount > due) {
      throw new AppError(400, `Only ${formatINR(Math.max(due, 0))} is unpaid on this bill. Paying more would record the same payment twice.`);
    }
    supplierId = bill.supplierId;
    category = bill.category;
  }

  let paidTo = input.paidTo;
  if (supplierId) {
    const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, companyId }, select: { name: true } });
    if (!supplier) throw new NotFoundError('Supplier');
    paidTo = supplier.name; // the payee is always the supplier's current name
  }

  if (!input.allowDuplicate) {
    const twin = await prisma.expense.findFirst({
      where: {
        projectId: input.projectId,
        voidedAt: null,
        amount: input.amount,
        date: toDateOnly(input.date),
        ...(supplierId ? { supplierId } : { supplierId: null, paidTo: { equals: paidTo, mode: 'insensitive' } }),
        ...(editingId ? { id: { not: editingId } } : {}),
      },
      select: { id: true },
    });
    if (twin) throw new DuplicateError(`An expense of ${formatINR(input.amount)} to the same payee on this date is already saved.`);
  }

  const { allowDuplicate: _allow, attachments: _files, ...rest } = input;
  return { ...rest, supplierId, category, paidTo };
}

// ---- Expenses ----

export async function listExpenses(companyId: string, projectId?: string) {
  const expenses = await prisma.expense.findMany({
    where: { companyId, ...(projectId ? { projectId } : {}) },
    include: withAttachments,
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return expenses.map(toExpense);
}

export async function createExpense(auth: AuthContext, input: ExpenseInput) {
  const { requestId, ...fieldsInput } = input;
  if (requestId) {
    const existing = await prisma.expense.findFirst({ where: { requestId, companyId: auth.companyId }, include: withAttachments });
    if (existing) return toExpense(existing);
  }
  const data = await prepare(auth.companyId, fieldsInput);

  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        ...data,
        date: toDateOnly(data.date),
        companyId: auth.companyId,
        createdById: auth.userId,
        createdBy: auth.name,
        requestId: requestId ?? null,
      },
    });
    await syncAttachments(tx, auth, { expenseId: created.id }, input.attachments);
    await recordAudit(tx, auth, { entity: 'expense', entityId: created.id, projectId: created.projectId, action: 'created' });
    return created.id;
  });
  return toExpense(await findOwn(auth.companyId, id));
}

export async function updateExpense(auth: AuthContext, id: string, input: ExpenseUpdate) {
  const expense = await findOwn(auth.companyId, id);
  if (expense.voidedAt) throw new AppError(400, 'A voided entry cannot be edited.');
  if (input.projectId !== expense.projectId) {
    throw new AppError(400, 'An expense cannot be moved to another project. Void it and add it again.');
  }
  const { reason, ...fieldsInput } = input;
  const { projectId: _projectId, ...update } = await prepare(auth.companyId, fieldsInput, id);

  const current = toExpense(expense);
  const changes = [...diff(current, update, HISTORY_FIELDS), ...attachmentChange(current.attachments, input.attachments)];
  if (changes.length === 0) return current;

  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { ...update, date: toDateOnly(update.date) } });
    await syncAttachments(tx, auth, { expenseId: id }, input.attachments);
    await recordAudit(tx, auth, { entity: 'expense', entityId: id, projectId: expense.projectId, action: 'updated', changes, reason });
  });
  return toExpense(await findOwn(auth.companyId, id));
}

/** Expenses are never deleted: a voided expense stays visible but no longer counts in totals. */
export async function voidExpense(auth: AuthContext, id: string, reason: string) {
  const expense = await findOwn(auth.companyId, id);
  if (expense.voidedAt) throw new AppError(400, 'This entry is already voided.');
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { voidedAt: new Date(), voidedByName: auth.name, voidReason: reason } });
    await recordAudit(tx, auth, { entity: 'expense', entityId: id, projectId: expense.projectId, action: 'voided', reason });
  });
}
