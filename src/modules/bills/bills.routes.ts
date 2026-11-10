import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as bills from './bills.service.js';

export const billRoutes = Router();
billRoutes.use(requireAuth); // every bill route needs a logged-in user

// Anyone in the company can see bills and add a supplier bill.
billRoutes.get('/', async (req, res) => {
  const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
  res.json(await bills.listBills(getAuth(req).companyId, projectId));
});

billRoutes.post('/', async (req, res) => {
  const input = bills.billInput.parse(req.body);
  res.status(201).json(await bills.createBill(getAuth(req), input));
});

// Correcting or voiding a bill needs an owner or manager.
billRoutes.put('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const input = bills.billUpdate.parse(req.body);
  res.json(await bills.updateBill(getAuth(req), (req.params as { id: string }).id, input));
});

billRoutes.post('/:id/void', requireRole('owner', 'manager'), async (req, res) => {
  const { reason } = bills.voidInput.parse(req.body);
  await bills.voidBill(getAuth(req), (req.params as { id: string }).id, reason);
  res.status(204).end();
});
