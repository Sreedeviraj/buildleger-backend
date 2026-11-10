import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import * as projects from './projects.service.js';

export const projectRoutes = Router();
projectRoutes.use(requireAuth); // every project route needs a logged-in user

// Anyone in the company can see and create projects.
projectRoutes.get('/', async (req, res) => {
  res.json(await projects.listProjects(getAuth(req).companyId));
});

projectRoutes.get('/:id', async (req, res) => {
  res.json(await projects.getProject(getAuth(req).companyId, req.params.id));
});

projectRoutes.post('/', async (req, res) => {
  const input = projects.projectInput.parse(req.body);
  res.status(201).json(await projects.createProject(getAuth(req), input));
});

projectRoutes.get('/:id/budget-revisions', async (req, res) => {
  res.json(await projects.listBudgetRevisions(getAuth(req).companyId, req.params.id));
});

// Changing a project needs an owner or manager; deleting needs the owner.
projectRoutes.patch('/:id', requireRole('owner', 'manager'), async (req, res) => {
  const update = projects.projectUpdate.parse(req.body);
  res.json(await projects.updateProject(getAuth(req), (req.params as { id: string }).id, update));
});

projectRoutes.post('/:id/archive', requireRole('owner', 'manager'), async (req, res) => {
  const { archived } = projects.archiveInput.parse(req.body);
  res.json(await projects.setArchived(getAuth(req), (req.params as { id: string }).id, archived));
});

projectRoutes.post('/:id/budget', requireRole('owner', 'manager'), async (req, res) => {
  const input = projects.budgetInput.parse(req.body);
  res.json(await projects.reviseBudget(getAuth(req), (req.params as { id: string }).id, input));
});

projectRoutes.delete('/:id', requireRole('owner'), async (req, res) => {
  await projects.deleteProject(getAuth(req), (req.params as { id: string }).id);
  res.status(204).end();
});
