import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as expenses from './expenses.service.js';

export const expenseRoutes = Router();
expenseRoutes.use(requireAuth); // every expense route needs a logged-in user

// Anyone in the company can see expenses and record money paid out.
expenseRoutes.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  res.json(await expenses.listExpenses(getAuth(req).companyId, projectId));
});

expenseRoutes.post('/', async (req, res) => {
  const input = expenses.expenseInput.parse(req.body);
  res.status(201).json(await expenses.createExpense(getAuth(req), input));
});

// Correcting or voiding an expense needs an owner or manager.
expenseRoutes.put('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const input = expenses.expenseUpdate.parse(req.body);
  res.json(await expenses.updateExpense(getAuth(req), (req.params as { id: string }).id, input));
});

expenseRoutes.post('/:id/void', requireRole('owner', 'manager'), async (req, res) => {
  const { reason } = expenses.voidInput.parse(req.body);
  await expenses.voidExpense(getAuth(req), (req.params as { id: string }).id, reason);
  res.status(204).end();
});
