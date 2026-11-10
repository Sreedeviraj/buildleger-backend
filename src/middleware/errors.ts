import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({ message: err.issues[0]?.message ?? 'Invalid input.' });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ message: err.message, ...(err.code ? { code: err.code } : {}) });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong. Please try again.' });
};
