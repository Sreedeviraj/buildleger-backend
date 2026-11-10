import { prisma } from '../db.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuditAction, AuditEntity } from '../generated/prisma/enums.js';
import type { AuthContext } from '../middleware/auth.js';

export type Change = { field: string; from: string; to: string };

/** The fields that `update` actually changes, formatted for the history screen. */
export function diff(before: Record<string, unknown>, update: Record<string, unknown>, fields: readonly string[]): Change[] {
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
  return fields
    .filter((f) => update[f] !== undefined && update[f] !== before[f])
    .map((f) => ({ field: f, from: show(before[f]), to: show(update[f]) }));
}

/** Writes one history entry. Pass the transaction client so it saves together with the change. */
export function recordAudit(
  db: Prisma.TransactionClient | typeof prisma,
  auth: AuthContext,
  entry: {
    entity: AuditEntity;
    entityId: string;
    projectId: string | null;
    action: AuditAction;
    changes?: Change[];
    reason?: string;
  },
) {
  return db.auditEvent.create({
    data: {
      companyId: auth.companyId,
      byName: auth.name,
      entity: entry.entity,
      entityId: entry.entityId,
      projectId: entry.projectId,
      action: entry.action,
      changes: entry.changes ?? [],
      reason: entry.reason ?? '',
    },
  });
}

/** Indian rupee format used in history entries, same as the frontend: ₹42,00,000 */
export function formatINR(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  return `${sign}₹${Math.abs(Math.round(amount)).toLocaleString('en-IN')}`;
}
