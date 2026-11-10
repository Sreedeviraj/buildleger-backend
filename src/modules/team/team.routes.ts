import { Router } from 'express';
import { getAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { setSessionCookie } from '../auth/auth.routes.js';
import * as team from './team.service.js';

/** /team: everyone in the company can see the team; only the owner can change it. */
export const teamRoutes = Router();
teamRoutes.use(requireAuth);

teamRoutes.get('/', async (req, res) => {
  res.json(await team.listTeam(getAuth(req).companyId));
});

teamRoutes.post('/invites', requireRole('owner'), async (req, res) => {
  res.status(201).json(await team.createInvite(getAuth(req), team.inviteInput.parse(req.body)));
});

teamRoutes.delete('/invites/:id', requireRole('owner'), async (req, res) => {
  await team.revokeInvite(getAuth(req).companyId, (req.params as { id: string }).id);
  res.status(204).end();
});

teamRoutes.patch('/members/:id', requireRole('owner'), async (req, res) => {
  res.json(await team.changeRole(getAuth(req), (req.params as { id: string }).id, team.roleInput.parse(req.body).role));
});

teamRoutes.delete('/members/:id', requireRole('owner'), async (req, res) => {
  await team.removeMember(getAuth(req), (req.params as { id: string }).id);
  res.status(204).end();
});

/** /invites/:token: opened from the invite link by someone who is not logged in yet. */
export const inviteRoutes = Router();

inviteRoutes.get('/:token', async (req, res) => {
  res.json(await team.getInvite(req.params.token));
});

inviteRoutes.post('/:token/accept', async (req, res) => {
  const result = await team.acceptInvite(req.params.token, team.acceptInput.parse(req.body));
  setSessionCookie(res, result.token, result.expiresAt);
  res.status(201).json(result.session);
});
