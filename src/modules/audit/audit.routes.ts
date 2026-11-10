import { Router } from 'express';
import { getAuth, requireAuth } from '../../middleware/auth.js';
import * as audit from './audit.service.js';

export const auditRoutes = Router();
auditRoutes.use(requireAuth);

// GET /audit?projectId=...&entityId=...
auditRoutes.get('/', async (req, res) => {
  res.json(await audit.listAudit(getAuth(req).companyId, audit.auditFilter.parse(req.query)));
});
