import { z } from 'zod';
import { prisma } from '../../db.js';
import type { Payment } from '../../generated/prisma/client.js';
import { PaymentKind, PaymentMode } from '../../generated/prisma/enums.js';
import { diff, formatINR, recordAudit } from '../../lib/audit.js';
import { fromDateOnly, toDateOnly } from '../../lib/dates.js';
import { AppError, DuplicateError, NotFoundError } from '../../lib/errors.js';
import { pastDate, voidedOf } from '../../lib/money.js';
import { amount, requiredText } from '../../lib/validation.js';
import type { AuthContext } from '../../middleware/auth.js';

// ---- Input rules ----

const fields = {
  projectId: requiredText('Please choose a project.'),
  kind: z.enum(PaymentKind, { error: 'Please choose a valid payment type.' }),
  amount: amount('an amount'),
  date: pastDate('payment date'),
  mode: z.enum(PaymentMode, { error: 'Please choose a valid payment method.' }),
  reference: z.string().trim().default(''),
  note: z.string().trim().default(''),
  /** The user saw the "already saved" warning and chose to save anyway. */
  allowDuplicate: z.boolean().default(false),
};

export const paymentInput = z.object({
  ...fields,
  /** Sent again when the user taps Save twice or the network retries; only one payment is saved. */
  requestId: z.string().max(100).optional(),
});
export type PaymentInput = z.infer<typeof paymentInput>;

export const paymentUpdate = z.object({ ...fields, reason: z.string().trim().default('') });
export type PaymentUpdate = z.infer<typeof paymentUpdate>;

export const voidInput = z.object({ reason: requiredText('Please give a reason for voiding.') });

const HISTORY_FIELDS = ['kind', 'amount', 'date', 'mode', 'reference', 'note'] as const;

// ---- Shape sent to the frontend (same as Payment in frontend/src/types.ts) ----

function toPayment(p: Payment) {
  const { voidedAt, voidedByName, voidReason, requestId: _requestId, ...rest } = p;
  return {
    ...rest,
    date: fromDateOnly(p.date),
    voided: voidedOf({ voidedAt, voidedByName, voidReason }),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Only this company's payment; another company's id looks exactly like a missing one. */
async function findOwn(companyId: string, id: string) {
  const payment = await prisma.payment.findFirst({ where: { id, companyId } });
  if (!payment) throw new NotFoundError('Payment');
  return payment;
}

/** Checks shared by add and edit. `editingId` leaves the payment being edited out of the totals. */
async function check(companyId: string, input: Omit<PaymentInput, 'requestId'>, editingId?: string) {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, companyId }, select: { id: true } });
  if (!project) throw new NotFoundError('Project');

  const others = { projectId: input.projectId, voidedAt: null, ...(editingId ? { id: { not: editingId } } : {}) };

  if (input.kind === 'refund') {
    const totals = await prisma.payment.groupBy({ by: ['kind'], where: others, _sum: { amount: true } });
    const received = totals.reduce((t, k) => t + (k.kind === 'refund' ? -1 : 1) * (k._sum.amount ?? 0), 0);
    if (input.amount > received) {
      throw new AppError(400, `The client has paid ${formatINR(Math.max(received, 0))} so far. A refund cannot be more than that.`);
    }
  }

  if (input.allowDuplicate) return;
  const twin = await prisma.payment.findFirst({
    where: { ...others, kind: input.kind, amount: input.amount, date: toDateOnly(input.date) },
    select: { id: true },
  });
  if (twin) {
    const what = input.kind === 'refund' ? 'refund' : 'payment';
    throw new DuplicateError(`A ${what} of ${formatINR(input.amount)} on this date is already saved for this project.`);
  }
}

// ---- Payments ----

export async function listPayments(companyId: string, projectId?: string) {
  const payments = await prisma.payment.findMany({
    where: { companyId, ...(projectId ? { projectId } : {}) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  return payments.map(toPayment);
}

export async function createPayment(auth: AuthContext, input: PaymentInput) {
  const { allowDuplicate: _allow, requestId, ...data } = input;
  if (requestId) {
    const existing = await prisma.payment.findFirst({ where: { requestId, companyId: auth.companyId } });
    if (existing) return toPayment(existing);
  }
  await check(auth.companyId, input);

  const payment = await prisma.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        ...data,
        date: toDateOnly(data.date),
        companyId: auth.companyId,
        createdById: auth.userId,
        createdBy: auth.name,
        requestId: requestId ?? null,
      },
    });
    await recordAudit(tx, auth, { entity: 'payment', entityId: created.id, projectId: created.projectId, action: 'created' });
    return created;
  });
  return toPayment(payment);
}

export async function updatePayment(auth: AuthContext, id: string, input: PaymentUpdate) {
  const payment = await findOwn(auth.companyId, id);
  if (payment.voidedAt) throw new AppError(400, 'A voided entry cannot be edited.');
  if (input.projectId !== payment.projectId) {
    throw new AppError(400, 'A payment cannot be moved to another project. Void it and add it again.');
  }
  await check(auth.companyId, input, id);

  const { allowDuplicate: _allow, reason, projectId: _projectId, ...update } = input;
  const current = toPayment(payment);
  const changes = diff(current, update, HISTORY_FIELDS);
  if (changes.length === 0) return current;

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({ where: { id }, data: { ...update, date: toDateOnly(update.date) } });
    await recordAudit(tx, auth, { entity: 'payment', entityId: id, projectId: payment.projectId, action: 'updated', changes, reason });
    return updated;
  });
  return toPayment(saved);
}

/** Payments are never deleted: a voided payment stays visible but no longer counts in totals. */
export async function voidPayment(auth: AuthContext, id: string, reason: string) {
  const payment = await findOwn(auth.companyId, id);
  if (payment.voidedAt) throw new AppError(400, 'This entry is already voided.');
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id }, data: { voidedAt: new Date(), voidedByName: auth.name, voidReason: reason } });
    await recordAudit(tx, auth, { entity: 'payment', entityId: id, projectId: payment.projectId, action: 'voided', reason });
  });
}
