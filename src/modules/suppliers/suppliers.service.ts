import { z } from 'zod';
import { prisma } from '../../db.js';
import type { Supplier } from '../../generated/prisma/client.js';
import { SupplierType } from '../../generated/prisma/enums.js';
import { diff, formatINR, recordAudit } from '../../lib/audit.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { phone, requiredText } from '../../lib/validation.js';
import type { AuthContext } from '../../middleware/auth.js';

// ---- Input rules ----

export const supplierInput = z.object({
  name: requiredText('Please enter the supplier name.'),
  type: z.enum(SupplierType, { error: 'Please choose a valid supplier type.' }),
  phone: phone.default(''),
  note: z.string().trim().default(''),
});
export type SupplierInput = z.infer<typeof supplierInput>;

export const archiveInput = z.object({ archived: z.boolean() });

const HISTORY_FIELDS = ['name', 'type', 'phone', 'note'] as const;

// ---- Shape sent to the frontend (same as Supplier in frontend/src/types.ts) ----

function toSupplier(s: Supplier) {
  return { ...s, createdAt: s.createdAt.toISOString() };
}

/** Only this company's supplier; another company's id looks exactly like a missing one. */
async function findOwn(companyId: string, id: string) {
  const supplier = await prisma.supplier.findFirst({ where: { id, companyId } });
  if (!supplier) throw new NotFoundError('Supplier');
  return supplier;
}

/** Names are unique within a company, ignoring capital letters. */
async function checkNameFree(companyId: string, name: string, exceptId?: string) {
  const twin = await prisma.supplier.findFirst({
    where: { companyId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (twin) throw new AppError(409, `${name} is already in your supplier list.`);
}

// ---- Suppliers ----

export async function listSuppliers(companyId: string) {
  const suppliers = await prisma.supplier.findMany({ where: { companyId }, orderBy: { name: 'asc' } });
  return suppliers.map(toSupplier);
}

export async function createSupplier(auth: AuthContext, input: SupplierInput) {
  await checkNameFree(auth.companyId, input.name);
  const supplier = await prisma.$transaction(async (tx) => {
    const created = await tx.supplier.create({ data: { ...input, companyId: auth.companyId } });
    await recordAudit(tx, auth, { entity: 'supplier', entityId: created.id, projectId: null, action: 'created' });
    return created;
  });
  return toSupplier(supplier);
}

export async function updateSupplier(auth: AuthContext, id: string, input: SupplierInput) {
  const current = await findOwn(auth.companyId, id);
  await checkNameFree(auth.companyId, input.name, id);
  const changes = diff(current, input, HISTORY_FIELDS);
  if (changes.length === 0) return toSupplier(current);

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({ where: { id }, data: input });
    // Keep the payee name on past payments in step with the supplier record.
    if (input.name !== current.name) {
      await tx.expense.updateMany({ where: { supplierId: id }, data: { paidTo: input.name } });
    }
    await recordAudit(tx, auth, { entity: 'supplier', entityId: id, projectId: null, action: 'updated', changes });
    return updated;
  });
  return toSupplier(saved);
}

/** What is still owed on this supplier's bills (voided bills and payments don't count). */
async function unpaidTo(supplierId: string) {
  const [billed, paid] = await Promise.all([
    prisma.bill.findMany({ where: { supplierId, voidedAt: null }, select: { id: true, amount: true } }),
    prisma.expense.groupBy({
      by: ['billId'],
      where: { bill: { supplierId }, voidedAt: null },
      _sum: { amount: true },
    }),
  ]);
  const paidByBill = new Map(paid.map((p) => [p.billId, p._sum.amount ?? 0]));
  return billed.reduce((total, b) => total + Math.max(b.amount - (paidByBill.get(b.id) ?? 0), 0), 0);
}

/** Archived suppliers drop out of the pickers; their bills and payments stay. */
export async function setArchived(auth: AuthContext, id: string, archived: boolean) {
  const supplier = await findOwn(auth.companyId, id);
  if (supplier.archived === archived) return toSupplier(supplier);
  if (archived) {
    const unpaid = await unpaidTo(id);
    if (unpaid > 0) {
      throw new AppError(409, `${formatINR(unpaid)} is still unpaid to ${supplier.name}. Pay or void those bills before archiving.`);
    }
  }
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({ where: { id }, data: { archived } });
    await recordAudit(tx, auth, {
      entity: 'supplier',
      entityId: id,
      projectId: null,
      action: archived ? 'archived' : 'restored',
    });
    return updated;
  });
  return toSupplier(saved);
}
