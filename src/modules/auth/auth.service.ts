import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { AppError } from '../../lib/errors.js';

const SESSION_DAYS = 30;

export type Role = 'owner' | 'manager' | 'staff';

const email = z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email.'));

export const signupInput = z.object({
  companyName: z.string().trim().min(1, 'Please enter your company name.'),
  city: z.string().trim().min(1, 'Please enter your city.'),
  name: z.string().trim().min(1, 'Please enter your name.'),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const loginInput = z.object({
  email,
  password: z.string().min(1, 'Please enter your password.'),
});

// The browser gets a random token; the database only stores its hash,
// so a leaked database can't be used to log in.
export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  return { token, expiresAt };
}

// Same shape as Session in the frontend's types.ts.
type UserWithCompany = {
  id: string;
  companyId: string;
  name: string;
  email: string;
  role: Role;
  company: { id: string; name: string; city: string };
};

export function toSession(user: UserWithCompany) {
  const { company } = user;
  return {
    user: { id: user.id, companyId: user.companyId, name: user.name, email: user.email, role: user.role },
    company: { id: company.id, name: company.name, city: company.city },
  };
}

export async function signup(input: z.infer<typeof signupInput>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError(409, 'An account with this email already exists.');

  // Creates the company (tenant) and its owner together: both or neither.
  const company = await prisma.company.create({
    data: {
      name: input.companyName,
      city: input.city,
      users: {
        create: {
          name: input.name,
          email: input.email,
          passwordHash: await bcrypt.hash(input.password, 12),
          role: 'owner',
        },
      },
    },
    include: { users: true },
  });
  const user = { ...company.users[0]!, company };
  return { session: toSession(user), ...(await createSession(user.id)) };
}

export async function login(input: z.infer<typeof loginInput>) {
  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { company: true } });
  const ok = user && (await bcrypt.compare(input.password, user.passwordHash));
  if (!ok) throw new AppError(401, 'Invalid email or password.');
  return { session: toSession(user), ...(await createSession(user.id)) };
}

export async function findSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { company: true } } },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }
  return toSession(session.user);
}

export async function logout(token: string) {
  await prisma.session.deleteMany({ where: { id: hashToken(token) } });
}
