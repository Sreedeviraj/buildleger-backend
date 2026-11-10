import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as suppliers from './suppliers.service.js';

export const supplierRoutes = Router();
supplierRoutes.use(requireAuth); // every supplier route needs a logged-in user

// Anyone in the company can see, add and correct suppliers (site staff add them while buying).
supplierRoutes.get('/', async (req, res) => {
  res.json(await suppliers.listSuppliers(getAuth(req).companyId));
});

supplierRoutes.post('/', async (req, res) => {
  const input = suppliers.supplierInput.parse(req.body);
  res.status(201).json(await suppliers.createSupplier(getAuth(req), input));
});

supplierRoutes.put('/:id', async (req, res) => {
  const input = suppliers.supplierInput.parse(req.body);
  res.json(await suppliers.updateSupplier(getAuth(req), req.params.id, input));
});

// Archiving or restoring needs an owner or manager.
supplierRoutes.post('/:id/archive', requireRole('owner', 'manager'), async (req, res) => {
  const { archived } = suppliers.archiveInput.parse(req.body);
  res.json(await suppliers.setArchived(getAuth(req), (req.params as { id: string }).id, archived));
});
