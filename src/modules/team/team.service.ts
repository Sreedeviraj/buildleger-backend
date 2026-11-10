import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import type { AuthContext } from '../../middleware/auth.js';
import { createSession, hashToken, toSession } from '../auth/auth.service.js';

const INVITE_DAYS = 7;

/** Only these roles can be given; there is exactly one owner, the person who signed up. */
const teamRole = z.enum(['manager', 'staff'], 'Please choose Manager or Site staff.');

export const inviteInput = z.object({
  name: z.string().trim().min(1, 'Please enter their name.'),
  email: z.string().trim().toLowerCase().pipe(z.email('Please enter a valid email.')),
  role: teamRole,
});

export const roleInput = z.object({ role: teamRole });

export const acceptInput = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export async function listTeam(companyId: string) {
  const [members, invites] = await Promise.all([
    prisma.user.findMany({
      where: { companyId },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invite.findMany({
      where: { companyId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, name: true, email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return { members, invites };
}

/**
 * Creates an invite and returns its one-time link. The token is shown only now;
 * the database keeps its hash. Inviting the same email again replaces the old link.
 */
export async function createInvite(auth: AuthContext, input: z.infer<typeof inviteInput>) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw new AppError(409, existing.companyId === auth.companyId ? `${input.email} is already in your team.` : 'This email already has a BuildLedger account.');
  }
  const token = randomBytes(32).toString('base64url');
  const invite = await prisma.$transaction(async (tx) => {
    await tx.invite.deleteMany({ where: { companyId: auth.companyId, email: input.email, acceptedAt: null } });
    return tx.invite.create({
      data: {
        ...input,
        companyId: auth.companyId,
        tokenHash: hashToken(token),
        invitedById: auth.userId,
        expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
      },
      select: { id: true, name: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
  });
  return { invite, link: `${config.frontendUrl}/invite/${token}` };
}

export async function revokeInvite(companyId: string, inviteId: string) {
  const { count } = await prisma.invite.deleteMany({ where: { id: inviteId, companyId, acceptedAt: null } });
  if (count === 0) throw new NotFoundError('Invite');
}

async function findTeamMember(auth: AuthContext, userId: string) {
  if (userId === auth.userId) throw new AppError(400, 'You cannot change your own access.');
  const member = await prisma.user.findFirst({ where: { id: userId, companyId: auth.companyId } });
  if (!member) throw new NotFoundError('Team member');
  if (member.role === 'owner') throw new AppError(400, 'The owner’s access cannot be changed.');
  return member;
}

export async function changeRole(auth: AuthContext, userId: string, role: z.infer<typeof teamRole>) {
  await findTeamMember(auth, userId);
  return prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
}

/** Removing a member deletes their login (and all their sessions); records they entered keep their name. */
export async function removeMember(auth: AuthContext, userId: string) {
  await findTeamMember(auth, userId);
  await prisma.user.delete({ where: { id: userId } });
}

async function findOpenInvite(token: string) {
  const invite = await prisma.invite.findUnique({ where: { tokenHash: hashToken(token) }, include: { company: true } });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new AppError(404, 'This invite link is not valid any more. Ask the owner to send a new one.');
  }
  return invite;
}

/** Public: what the invite page shows before the person sets a password. */
export async function getInvite(token: string) {
  const invite = await findOpenInvite(token);
  return { name: invite.name, email: invite.email, role: invite.role, companyName: invite.company.name };
}

/** Public: creates the account, marks the invite used and logs the new member in. */
export async function acceptInvite(token: string, input: z.infer<typeof acceptInput>) {
  const invite = await findOpenInvite(token);
  if (await prisma.user.findUnique({ where: { email: invite.email } })) {
    throw new AppError(409, 'An account with this email already exists. Please log in.');
  }
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.$transaction(async (tx) => {
    // Marking it used inside the transaction means a link can only ever be used once.
    const { count } = await tx.invite.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (count === 0) throw new AppError(409, 'This invite has already been used.');
    return tx.user.create({
      data: { companyId: invite.companyId, name: invite.name, email: invite.email, role: invite.role, passwordHash },
      include: { company: true },
    });
  });
  return { session: toSession(user), ...(await createSession(user.id)) };
}
