import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as payments from './payments.service.js';

export const paymentRoutes = Router();
paymentRoutes.use(requireAuth); // every payment route needs a logged-in user

// Anyone in the company can see payments and record money received.
paymentRoutes.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  res.json(await payments.listPayments(getAuth(req).companyId, projectId));
});

paymentRoutes.post('/', async (req, res) => {
  const input = payments.paymentInput.parse(req.body);
  res.status(201).json(await payments.createPayment(getAuth(req), input));
});

// Correcting or voiding a payment needs an owner or manager.
paymentRoutes.put('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const input = payments.paymentUpdate.parse(req.body);
  res.json(await payments.updatePayment(getAuth(req), (req.params as { id: string }).id, input));
});

paymentRoutes.post('/:id/void', requireRole('owner', 'manager'), async (req, res) => {
  const { reason } = payments.voidInput.parse(req.body);
  await payments.voidPayment(getAuth(req), (req.params as { id: string }).id, reason);
  res.status(204).end();
});
