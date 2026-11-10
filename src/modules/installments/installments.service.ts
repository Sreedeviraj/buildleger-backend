import { z } from 'zod';
import { prisma } from '../../db.js';
import type { Installment } from '../../generated/prisma/client.js';
import { formatINR, recordAudit } from '../../lib/audit.js';
import { fromDateOnly, toDateOnly } from '../../lib/dates.js';
import { NotFoundError } from '../../lib/errors.js';
import { amount, dateOnly, requiredText } from '../../lib/validation.js';
import type { AuthContext } from '../../middleware/auth.js';

// ---- Input rules ----

export const installmentInput = z.object({
  projectId: requiredText('Please choose a project.'),
  label: requiredText('Please enter what this payment is for.'),
  amount: amount('an amount'),
  dueDate: dateOnly('due date'), // past dates are fine: a schedule can be entered after work started
});
export type InstallmentInput = z.infer<typeof installmentInput>;

// ---- Shape sent to the frontend (same as Installment in frontend/src/types.ts) ----

function toInstallment(i: Installment) {
  const { createdAt: _createdAt, ...rest } = i;
  return { ...rest, dueDate: fromDateOnly(i.dueDate) };
}

// ---- Client payment schedule ----

export async function listInstallments(companyId: string, projectId?: string) {
  const installments = await prisma.installment.findMany({
    where: { companyId, ...(projectId ? { projectId } : {}) },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
  });
  return installments.map(toInstallment);
}

export async function createInstallment(auth: AuthContext, input: InstallmentInput) {
  const project = await prisma.project.findFirst({ where: { id: input.projectId, companyId: auth.companyId }, select: { id: true } });
  if (!project) throw new NotFoundError('Project');

  const installment = await prisma.$transaction(async (tx) => {
    const created = await tx.installment.create({
      data: { ...input, dueDate: toDateOnly(input.dueDate), companyId: auth.companyId },
    });
    await recordAudit(tx, auth, { entity: 'installment', entityId: created.id, projectId: created.projectId, action: 'created' });
    return created;
  });
  return toInstallment(installment);
}

/** A schedule line is only a plan (no money moved), so it can be deleted; history keeps what it was. */
export async function deleteInstallment(auth: AuthContext, id: string) {
  const installment = await prisma.installment.findFirst({ where: { id, companyId: auth.companyId } });
  if (!installment) throw new NotFoundError('Scheduled payment');
  await prisma.$transaction(async (tx) => {
    await tx.installment.delete({ where: { id } });
    await recordAudit(tx, auth, {
      entity: 'installment',
      entityId: id,
      projectId: installment.projectId,
      action: 'deleted',
      changes: [{ field: installment.label, from: formatINR(installment.amount), to: '—' }],
    });
  });
}
