import { z } from 'zod';
import { prisma } from '../../db.js';
import type { Prisma, Project } from '../../generated/prisma/client.js';
import { ExpenseCategory, ProjectStatus } from '../../generated/prisma/enums.js';
import { diff, formatINR, recordAudit } from '../../lib/audit.js';
import { fromDateOnly, toDateOnly } from '../../lib/dates.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { amount, dateOnly, optionalEmail, phone, requiredText } from '../../lib/validation.js';
import type { AuthContext } from '../../middleware/auth.js';

// ---- Input rules ----

const categoryBudgets = z.partialRecord(
  z.enum(ExpenseCategory),
  z.number().int('Category budgets must be whole rupees.').min(0, 'Category budgets must be zero or more.'),
);
type CategoryBudgets = z.infer<typeof categoryBudgets>;

const fields = {
  name: requiredText('Please enter a project name.'),
  clientName: requiredText('Please enter the client name.'),
  clientPhone: phone,
  clientEmail: optionalEmail('Please enter a valid client email.'),
  clientAddress: z.string().trim(),
  location: requiredText('Please enter the site address.'),
  contractValue: amount('the contract value'),
  estimatedCost: amount('the estimated cost'),
  startDate: dateOnly('start date'),
  expectedEndDate: z.union([z.literal(''), dateOnly('expected completion date')]),
};

const END_BEFORE_START = 'The expected completion date must be after the start date.';

export const projectInput = z
  .object({
    ...fields,
    clientPhone: fields.clientPhone.default(''),
    clientEmail: fields.clientEmail.default(''),
    clientAddress: fields.clientAddress.default(''),
    expectedEndDate: fields.expectedEndDate.default(''),
  })
  .refine((p) => !p.expectedEndDate || p.expectedEndDate >= p.startDate, { message: END_BEFORE_START });
export type ProjectInput = z.infer<typeof projectInput>;

export const projectUpdate = z
  .object({
    ...fields,
    progress: z.number().int().min(0).max(100, 'Progress must be between 0 and 100.'),
    status: z.enum(ProjectStatus, { error: 'Please choose a valid status.' }),
  })
  .partial();
export type ProjectUpdate = z.infer<typeof projectUpdate>;

export const archiveInput = z.object({ archived: z.boolean() });

export const budgetInput = z.object({
  estimatedCost: amount('the estimated cost'),
  categoryBudgets,
  reason: requiredText('Please give a reason for this budget change.'),
});

/** Fields shown in a project's change history. The budget has its own history (revisions). */
const HISTORY_FIELDS = [
  'name',
  'clientName',
  'clientPhone',
  'clientEmail',
  'clientAddress',
  'location',
  'contractValue',
  'startDate',
  'expectedEndDate',
  'progress',
  'status',
] as const;

// ---- Shape sent to the frontend (same as Project in frontend/src/types.ts) ----

function toProject(p: Project) {
  return {
    ...p,
    categoryBudgets: p.categoryBudgets as CategoryBudgets,
    startDate: fromDateOnly(p.startDate),
    expectedEndDate: p.expectedEndDate ? fromDateOnly(p.expectedEndDate) : '',
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Only this company's project; another company's id looks exactly like a missing one. */
async function findOwn(companyId: string, id: string) {
  const project = await prisma.project.findFirst({ where: { id, companyId } });
  if (!project) throw new NotFoundError('Project');
  return project;
}

// ---- Projects ----

export async function listProjects(companyId: string) {
  const projects = await prisma.project.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } });
  return projects.map(toProject);
}

export async function getProject(companyId: string, id: string) {
  return toProject(await findOwn(companyId, id));
}

export async function createProject(auth: AuthContext, input: ProjectInput) {
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        ...input,
        companyId: auth.companyId,
        startDate: toDateOnly(input.startDate),
        expectedEndDate: input.expectedEndDate ? toDateOnly(input.expectedEndDate) : null,
      },
    });
    await recordAudit(tx, auth, { entity: 'project', entityId: created.id, projectId: created.id, action: 'created' });
    return created;
  });
  return toProject(project);
}

export async function updateProject(auth: AuthContext, id: string, update: ProjectUpdate) {
  const current = toProject(await findOwn(auth.companyId, id));
  if (update.estimatedCost !== undefined && update.estimatedCost !== current.estimatedCost) {
    throw new AppError(400, 'Change the estimated cost with “Revise budget” so the change is recorded.');
  }
  const startDate = update.startDate ?? current.startDate;
  const expectedEndDate = update.expectedEndDate ?? current.expectedEndDate;
  if (expectedEndDate && expectedEndDate < startDate) throw new AppError(400, END_BEFORE_START);

  const changes = diff(current, update, HISTORY_FIELDS);
  if (changes.length === 0) return current;

  // Save only the fields that changed, turning 'YYYY-MM-DD' strings back into dates.
  const data: Prisma.ProjectUpdateInput = {};
  for (const { field } of changes) {
    if (field === 'startDate') data.startDate = toDateOnly(startDate);
    else if (field === 'expectedEndDate') data.expectedEndDate = expectedEndDate ? toDateOnly(expectedEndDate) : null;
    else Object.assign(data, { [field]: update[field as keyof ProjectUpdate] });
  }

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id }, data });
    await recordAudit(tx, auth, { entity: 'project', entityId: id, projectId: id, action: 'updated', changes });
    return updated;
  });
  return toProject(saved);
}

export async function setArchived(auth: AuthContext, id: string, archived: boolean) {
  await findOwn(auth.companyId, id);
  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.project.update({ where: { id }, data: { archived } });
    await recordAudit(tx, auth, {
      entity: 'project',
      entityId: id,
      projectId: id,
      action: archived ? 'archived' : 'restored',
    });
    return updated;
  });
  return toProject(saved);
}

/** Only projects with no money records can be deleted; others must be archived. */
export async function deleteProject(auth: AuthContext, id: string) {
  await findOwn(auth.companyId, id);
  const where = { projectId: id };
  const [payments, expenses, bills] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.expense.count({ where }),
    prisma.bill.count({ where }),
  ]);
  if (payments + expenses + bills > 0) {
    throw new AppError(409, 'This project has money records, so it cannot be deleted. Archive it instead.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.project.delete({ where: { id } }); // its installments and budget revisions go with it
    await recordAudit(tx, auth, { entity: 'project', entityId: id, projectId: null, action: 'deleted' });
  });
}

// ---- Budget ----

type Budget = { estimatedCost: number; categoryBudgets: CategoryBudgets };

/** Same budget regardless of key order, ignoring zero categories. */
function sameBudget(a: Budget, b: Budget) {
  const norm = (x: CategoryBudgets) => JSON.stringify(Object.entries(x).filter(([, v]) => v).sort());
  return a.estimatedCost === b.estimatedCost && norm(a.categoryBudgets) === norm(b.categoryBudgets);
}

export async function reviseBudget(auth: AuthContext, id: string, input: z.infer<typeof budgetInput>) {
  const project = toProject(await findOwn(auth.companyId, id));
  const before: Budget = { estimatedCost: project.estimatedCost, categoryBudgets: project.categoryBudgets };
  const after: Budget = {
    estimatedCost: input.estimatedCost,
    categoryBudgets: Object.fromEntries(Object.entries(input.categoryBudgets).filter(([, v]) => v && v > 0)),
  };
  if (sameBudget(before, after)) throw new AppError(400, 'Nothing was changed.');

  const saved = await prisma.$transaction(async (tx) => {
    await tx.budgetRevision.create({
      data: { companyId: auth.companyId, projectId: id, byName: auth.name, reason: input.reason, before, after },
    });
    const updated = await tx.project.update({ where: { id }, data: after });
    await recordAudit(tx, auth, {
      entity: 'project',
      entityId: id,
      projectId: id,
      action: 'updated',
      changes: [{ field: 'budget', from: formatINR(before.estimatedCost), to: formatINR(after.estimatedCost) }],
      reason: input.reason,
    });
    return updated;
  });
  return toProject(saved);
}

export async function listBudgetRevisions(companyId: string, projectId: string) {
  await findOwn(companyId, projectId);
  const revisions = await prisma.budgetRevision.findMany({ where: { companyId, projectId }, orderBy: { at: 'desc' } });
  return revisions.map((r) => ({ ...r, at: r.at.toISOString() }));
}
