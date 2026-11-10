import type { Request, RequestHandler } from 'express';
import { AppError } from '../lib/errors.js';
import { findSession, type Role } from '../modules/auth/auth.service.js';

export const SESSION_COOKIE = 'bl_session';

export interface AuthContext {
  userId: string;
  companyId: string;
  role: Role;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? await findSession(token) : null;
  if (!session) throw new AppError(401, 'Please log in.');

  const { user } = session;
  req.auth = { userId: user.id, companyId: user.companyId, role: user.role, name: user.name };
  next();
};

export function requireRole(...roles: AuthContext['role'][]): RequestHandler {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      throw new AppError(403, 'You do not have permission to do this.');
    }
    next();
  };
}

/** Use inside routes protected by requireAuth. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw new AppError(401, 'Please log in.');
  return req.auth;
}
