import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as installments from './installments.service.js';

export const installmentRoutes = Router();
installmentRoutes.use(requireAuth); // every schedule route needs a logged-in user

// Anyone in the company can see the schedule.
installmentRoutes.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  res.json(await installments.listInstallments(getAuth(req).companyId, projectId));
});

// Planning what the client pays when needs an owner or manager.
installmentRoutes.post('/', requireRole('owner', 'manager'), async (req, res) => {
  const input = installments.installmentInput.parse(req.body);
  res.status(201).json(await installments.createInstallment(getAuth(req), input));
});

installmentRoutes.delete('/:id', requireRole('owner', 'manager'), async (req, res) => {
  await installments.deleteInstallment(getAuth(req), (req.params as { id: string }).id);
  res.status(204).end();
});
