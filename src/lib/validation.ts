// Input rules shared by every module. Messages are shown to the user as they are.
import { z } from 'zod';

/** Largest amount a Postgres Int column can hold (about ₹214 crore). */
const MAX_AMOUNT = 2_147_483_647;

export const amount = (label: string) =>
  z
    .number({ error: `Please enter ${label}.` })
    .int(`Please enter ${label} in whole rupees.`)
    .positive(`Please enter ${label} above zero.`)
    .max(MAX_AMOUNT, `Please enter a smaller ${label}.`);

/** A real calendar day in 'YYYY-MM-DD' form (rejects 2026-02-30). */
export const dateOnly = (label: string) =>
  z.string({ error: `Please choose a valid ${label}.` }).refine(
    (v) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const date = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(v);
    },
    { message: `Please choose a valid ${label}.` },
  );

/** Empty, or a 10-digit Indian mobile number (optionally with +91). */
export const phone = z
  .string()
  .trim()
  .refine(
    (v) => {
      if (!v) return true;
      const digits = v.replace(/\D/g, '');
      return digits.length === 10 || (digits.length === 12 && digits.startsWith('91'));
    },
    { message: 'Please enter a 10-digit mobile number.' },
  );

/** Empty, or something that looks like an email. */
export const optionalEmail = (message: string) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => !v || /^\S+@\S+\.\S+$/.test(v), { message });

export const requiredText = (message: string) => z.string({ error: message }).trim().min(1, message);
