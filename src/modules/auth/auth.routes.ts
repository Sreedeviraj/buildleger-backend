import { Router, type Response } from 'express';
import { config } from '../../config.js';
import { AppError } from '../../lib/errors.js';
import { SESSION_COOKIE } from '../../middleware/auth.js';
import * as auth from './auth.service.js';

export const authRoutes = Router();

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript in the page can't read it
    sameSite: 'lax',
    secure: config.isProduction, // HTTPS only in production
    expires,
    path: '/',
  });
}

authRoutes.post('/signup', async (req, res) => {
  const result = await auth.signup(auth.signupInput.parse(req.body));
  setSessionCookie(res, result.token, result.expiresAt);
  res.status(201).json(result.session);
});

authRoutes.post('/login', async (req, res) => {
  const result = await auth.login(auth.loginInput.parse(req.body));
  setSessionCookie(res, result.token, result.expiresAt);
  res.json(result.session);
});

authRoutes.post('/logout', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await auth.logout(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.status(204).end();
});

authRoutes.get('/me', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? await auth.findSession(token) : null;
  if (!session) throw new AppError(401, 'Please log in.');
  res.json(session);
});
