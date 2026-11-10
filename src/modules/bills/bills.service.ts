import { z } from 'zod';
import { prisma } from '../../db.js';
import type { Attachment, Bill } from '../../generated/prisma/client.js';
import { ExpenseCategory } from '../../generated/prisma/enums.js';
import { diff, formatINR, recordAudit } from '../../lib/audit.js';
import { fromDateOnly, toDateOnly } from '../../lib/dates.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import {
  attachmentChange,
  attachmentsInput,
  pastDate,
  syncAttachments,
  toAttachment,
  voidedOf,
  withAttachments,
} from '../../lib/money.js';
import { amount, dateOnly, requiredText } from '../../lib/validation.js';
import type { AuthContext } from '../../middleware/auth.js';

// ---- Input rules ----

const fields = z
  .object({
    projectId: requiredText('Please choose a project.'),
    supplierId: requiredText('Please choose a supplier.'),
    category: z.enum(ExpenseCategory, { error: 'Please choose a valid category.' }),
    billNumber: z.string().trim().default(''),
    billDate: pastDate('bill date'),
    dueDate: z.union([z.literal(''), dateOnly('due date')]).default(''),
    amount: amount('the bill amount'),
    note: z.string().trim().default(''),
    attachments: attachmentsInput,
    allowDuplicate: z.boolean().default(false), // sent by the shared form code; bills have no duplicate warning
  })
  .refine((b) => !b.dueDate || b.dueDate >= b.billDate, { message: 'The due date must be on or after the bill date.' });

export const billInput = fields.and(z.object({ requestId: z.string().max(100).optional() }));
export type BillInput = z.infer<typeof billInput>;

export const billUpdate = fields.and(z.object({ reason: z.string().trim().default('') }));
export type BillUpdate = z.infer<typeof billUpdate>;

export const voidInput = z.object({ reason: requiredText('Please give a reason for voiding.') });

const HISTORY_FIELDS = ['supplierId', 'category', 'billNumber', 'billDate', 'dueDate', 'amount', 'note'] as const;

// ---- Shape sent to the frontend (same as Bill in frontend/src/types.ts) ----

function toBill(b: Bill & { attachments: Attachment[] }) {
  const { voidedAt, voidedByName, voidReason, requestId: _requestId, ...rest } = b;
  return {
    ...rest,
    billDate: fromDateOnly(b.billDate),
    dueDate: b.dueDate ? fromDateOnly(b.dueDate) : '',
    attachments: b.attachments.map(toAttachment),
    voided: voidedOf({ voidedAt, voidedByName, voidReason }),
    createdAt: b.createdAt.toISOString(),
    updatedAt: b.updatedAt.toISOString(),
  };
}

/** Only this company's bill; another company's id looks exactly like a missing one. */
async function findOwn(companyId: string, id: string) {
  const bill = await prisma.bill.findFirst({ where: { id, companyId }, include: withAttachments });
  if (!bill) throw new NotFoundError('Bill');
  return bill;
}

/** Total of the (not voided) expenses that paid this bill. */
export async function paidOnBill(billId: string, exceptExpenseId?: string) {
  const sum = await prisma.expense.aggregate({
    where: { billId, voidedAt: null, ...(exceptExpenseId ? { id: { not: exceptExpenseId } } : {}) },
    _sum: { amount: true },
  });
  return sum._sum.amount ?? 0;
}

/** Checks shared by add and edit. */
async function check(companyId: string, input: z.infer<typeof fields>, editingId?: string) {
  const [project, supplier] = await Promise.all([
    prisma.project.findFirst({ where: { id: input.projectId, companyId }, select: { id: true } }),
    prisma.supplier.findFirst({ where: { id: input.supplierId, companyId }, select: { id: true } }),
  ]);
  if (!project) throw new NotFoundError('Project');
  if (!supplier) throw new NotFoundError('Supplier');

  if (editingId) {
    const paid = await paidOnBill(editingId);
    if (input.amount < paid) {
      throw new AppError(400, `${formatINR(paid)} is already paid against this bill. The amount cannot be lower.`);
    }
  }

  if (input.billNumber) {
    const sameNumber = await prisma.bill.findFirst({
      where: {
        supplierId: input.supplierId,
        voidedAt: null,
        billNumber: { equals: input.billNumber, mode: 'insensitive' },
        ...(editingId ? { id: { not: editingId } } : {}),
      },
      select: { id: true },
    });
    if (sameNumber) throw new AppError(409, `Bill number ${input.billNumber} from this supplier is already saved.`);
  }
}

const toData = (input: z.infer<typeof fields>) => {
  const { allowDuplicate: _allow, attachments: _files, ...rest } = input;
  return { ...rest, billDate: toDateOnly(rest.billDate), dueDate: rest.dueDate ? toDateOnly(rest.dueDate) : null };
};

// ---- Bills ----

export async function listBills(companyId: string, projectId?: string) {
  const bills = await prisma.bill.findMany({
    where: { companyId, ...(projectId ? { projectId } : {}) },
    include: withAttachments,
    orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
  });
  return bills.map(toBill);
}

export async function createBill(auth: AuthContext, input: BillInput) {
  const { requestId, ...fieldsInput } = input;
  if (requestId) {
    const existing = await prisma.bill.findFirst({ where: { requestId, companyId: auth.companyId }, include: withAttachments });
    if (existing) return toBill(existing);
  }
  await check(auth.companyId, fieldsInput);

  const id = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        ...toData(fieldsInput),
        companyId: auth.companyId,
        createdById: auth.userId,
        createdBy: auth.name,
        requestId: requestId ?? null,
      },
    });
    await syncAttachments(tx, auth, { billId: created.id }, input.attachments);
    await recordAudit(tx, auth, { entity: 'bill', entityId: created.id, projectId: created.projectId, action: 'created' });
    return created.id;
  });
  return toBill(await findOwn(auth.companyId, id));
}

export async function updateBill(auth: AuthContext, id: string, input: BillUpdate) {
  const bill = await findOwn(auth.companyId, id);
  if (bill.voidedAt) throw new AppError(400, 'A voided bill cannot be edited.');
  if (input.projectId !== bill.projectId) {
    throw new AppError(400, 'A bill cannot be moved to another project. Void it and add it again.');
  }
  if (input.supplierId !== bill.supplierId && (await paidOnBill(id)) > 0) {
    throw new AppError(400, 'Payments are linked to this bill, so its supplier cannot be changed.');
  }
  await check(auth.companyId, input, id);

  const { reason, ...rest } = input;
  const current = toBill(bill);
  const changes = [...diff(current, rest, HISTORY_FIELDS), ...attachmentChange(current.attachments, input.attachments)];
  if (changes.length === 0) return current;

  await prisma.$transaction(async (tx) => {
    await tx.bill.update({ where: { id }, data: toData(rest) });
    // Linked payments follow the bill's category so costs are reported in one place.
    if (input.category !== bill.category) {
      await tx.expense.updateMany({ where: { billId: id }, data: { category: input.category } });
    }
    await syncAttachments(tx, auth, { billId: id }, input.attachments);
    await recordAudit(tx, auth, { entity: 'bill', entityId: id, projectId: bill.projectId, action: 'updated', changes, reason });
  });
  return toBill(await findOwn(auth.companyId, id));
}

export async function voidBill(auth: AuthContext, id: string, reason: string) {
  const bill = await findOwn(auth.companyId, id);
  if (bill.voidedAt) throw new AppError(400, 'This entry is already voided.');
  if ((await paidOnBill(id)) > 0) throw new AppError(400, 'Payments are linked to this bill. Void those payments first.');
  await prisma.$transaction(async (tx) => {
    await tx.bill.update({ where: { id }, data: { voidedAt: new Date(), voidedByName: auth.name, voidReason: reason } });
    await recordAudit(tx, auth, { entity: 'bill', entityId: id, projectId: bill.projectId, action: 'voided', reason });
  });
}
