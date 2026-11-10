// Shared by payments, expenses and bills.
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import type { AuthContext } from '../middleware/auth.js';
import { todayISO } from './dates.js';
import { AppError } from './errors.js';
import { dateOnly } from './validation.js';

/** A real day that is today or earlier (money cannot be paid tomorrow). */
export const pastDate = (label: string) =>
  dateOnly(label).refine((d) => d <= todayISO(), { message: `The ${label} cannot be in the future.` });

/** Optional id from a picker: '' and null both mean "none". */
export const optionalId = z
  .string()
  .nullable()
  .default(null)
  .transform((v) => v || null);

/** How a voided record looks to the frontend: { at, byName, reason } or null. */
export function voidedOf(r: { voidedAt: Date | null; voidedByName: string | null; voidReason: string | null }) {
  return r.voidedAt ? { at: r.voidedAt.toISOString(), byName: r.voidedByName ?? '', reason: r.voidReason ?? '' } : null;
}

// ---- Attachments ----
// The files themselves are still kept in the user's browser (frontend/src/lib/attachments.ts),
// so only their details are saved here, under the id the browser gave them.

const MAX_FILE_BYTES = 5 * 1024 * 1024;

export const attachmentsInput = z
  .array(
    z.object({
      id: z.string().regex(/^att_[a-z0-9]{1,40}$/, 'This file could not be attached. Please add it again.'),
      name: z.string().trim().min(1).max(255),
      type: z.string().refine((t) => t.startsWith('image/') || t === 'application/pdf', {
        message: 'Only photos and PDF files can be attached.',
      }),
      size: z.number().int().positive().max(MAX_FILE_BYTES, 'Files must be 5 MB or smaller.'),
    }),
  )
  .max(20, 'Up to 20 files can be attached.')
  .default([]);
export type AttachmentInput = z.infer<typeof attachmentsInput>[number];

export const withAttachments = { attachments: { orderBy: { createdAt: 'asc' } } } as const;

export function toAttachment(a: { id: string; name: string; mimeType: string; size: number }) {
  return { id: a.id, name: a.name, type: a.mimeType, size: a.size };
}

/** Makes the record's files match `wanted`: new ones are added, missing ones removed. */
export async function syncAttachments(
  tx: Prisma.TransactionClient,
  auth: AuthContext,
  owner: { expenseId: string } | { billId: string },
  wanted: AttachmentInput[],
) {
  const unique = [...new Map(wanted.map((a) => [a.id, a])).values()];
  const ids = unique.map((a) => a.id);
  await tx.attachment.deleteMany({ where: { ...owner, id: { notIn: ids } } });
  const existing = new Set((await tx.attachment.findMany({ where: { ...owner }, select: { id: true } })).map((a) => a.id));
  for (const a of unique) {
    if (existing.has(a.id)) continue;
    if (await tx.attachment.findUnique({ where: { id: a.id }, select: { id: true } })) {
      throw new AppError(400, `${a.name} is already attached to another entry. Please add the file again.`);
    }
    await tx.attachment.create({
      data: {
        id: a.id,
        companyId: auth.companyId,
        ...owner,
        name: a.name,
        mimeType: a.type,
        size: a.size,
        storagePath: `browser:${a.id}`,
        uploadedBy: auth.name,
      },
    });
  }
}

/** History entry for a changed file list, e.g. "attachments: 1 → 2". */
export function attachmentChange(before: { id: string }[], after: { id: string }[]) {
  const key = (list: { id: string }[]) => list.map((a) => a.id).sort().join(',');
  return key(before) === key(after) ? [] : [{ field: 'attachments', from: String(before.length), to: String(after.length) }];
}
