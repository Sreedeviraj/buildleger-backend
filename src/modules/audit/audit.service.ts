import { z } from 'zod';
import { prisma } from '../../db.js';

export const auditFilter = z.object({
  projectId: z.string().optional(),
  entityId: z.string().optional(),
});

export async function listAudit(companyId: string, filter: z.infer<typeof auditFilter>) {
  const events = await prisma.auditEvent.findMany({
    where: {
      companyId,
      ...(filter.projectId && { projectId: filter.projectId }),
      ...(filter.entityId && { entityId: filter.entityId }),
    },
    orderBy: { at: 'desc' },
  });
  return events.map((e) => ({ ...e, at: e.at.toISOString() }));
}
