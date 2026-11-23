import { createHash, randomBytes } from 'crypto';
import prisma from '../utils/prisma.js';
import { comparePassword, hashPassword, signToken } from '../utils/auth.js';
import { logAudit } from '../utils/audit.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function profileView(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department,
    departmentId: user.departmentId,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

export async function login(req, res) {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });
  const user = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() }, include: { department: true } });
  if (!user || !user.isActive) return res.status(401).json({ message: 'Invalid credentials' });
  const ok = await comparePassword(password, user.passwordHash);
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' });
  const token = signToken(user);
  await logAudit({ userId: user.id, action: 'LOGIN', entityType: 'User', entityId: user.id, req });
  const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role, departmentId: user.departmentId, department: user.department };
  res.json({ token, user: safeUser });
}

export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { department: true } });
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, departmentId: user.departmentId, department: user.department } });
}

export async function logout(req, res) {
  const payload = req.tokenPayload;
  if (payload?.jti) {
    await prisma.revokedToken.upsert({
      where: { id: payload.jti },
      update: {},
      create: {
        id: payload.jti,
        userId: req.user?.id || null,
        expiresAt: payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 8 * 3600 * 1000),
      },
    }).catch(() => {});
  }
  await logAudit({ userId: req.user?.id, action: 'LOGOUT', entityType: 'User', entityId: req.user?.id, details: { revoked: !!payload?.jti }, req });
  res.json({ message: 'Logged out' });
}

/** GET /api/auth/profile */
export async function getProfile(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { department: true } });
  if (!user) return res.status(404).json({ message: 'User not found' });
  res.json({ user: profileView(user) });
}

/** PUT /api/auth/profile — { name, email, currentPassword?, newPassword? } */
export async function updateProfile(req, res) {
  const { name, email, currentPassword, newPassword } = req.body || {};
  const data = {};
  if (name !== undefined) {
    if (!String(name).trim()) return res.status(400).json({ message: 'Name cannot be empty' });
    data.name = String(name).trim();
  }
  if (email !== undefined) {
    const normalized = String(email).toLowerCase().trim();
    if (!normalized) return res.status(400).json({ message: 'Email cannot be empty' });
    const existing = await prisma.user.findUnique({ where: { email: normalized } });
    if (existing && existing.id !== req.user.id) return res.status(409).json({ message: 'Email already exists' });
    data.email = normalized;
  }
  if (newPassword !== undefined || currentPassword !== undefined) {
    if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ message: 'New password must be at least 8 characters' });
    if (!currentPassword) return res.status(400).json({ message: 'Current password is required to change your password' });
    const ok = await comparePassword(currentPassword, req.user.passwordHash);
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
    data.passwordHash = await hashPassword(String(newPassword));
  }
  if (!Object.keys(data).length) return res.status(400).json({ message: 'No profile changes supplied' });

  try {
    const user = await prisma.user.update({ where: { id: req.user.id }, data, include: { department: true } });
    await logAudit({
      userId: req.user.id, action: 'UPDATE_PROFILE', entityType: 'User', entityId: user.id,
      details: { fields: Object.keys(data).filter((k) => k !== 'passwordHash'), passwordChanged: !!data.passwordHash }, req,
    });
    res.json({ user: profileView(user) });
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ message: 'Email already exists' });
    throw e;
  }
}

/** POST /api/auth/forgot — stores only a SHA-256 hash of a random token. */
export async function forgotPassword(req, res) {
  const email = String(req.body?.email || '').toLowerCase().trim();
  const generic = { message: 'If the account exists, a password reset token has been issued.' };
  if (!email) return res.status(400).json({ message: 'Email is required' });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return res.json(generic);

  const token = randomBytes(32).toString('hex');
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
  });
  await logAudit({ userId: user.id, action: 'PASSWORD_RESET_REQUEST', entityType: 'User', entityId: user.id, details: { expiresInHours: 1 }, req });

  const expose = process.env.NODE_ENV !== 'production' || process.env.RESET_TOKEN_IN_RESPONSE === 'true';
  if (expose) return res.json({ ...generic, resetToken: token });

  // Never print the raw token in production unless it was explicitly requested above.
  console.warn('[password-reset] A reset token was issued for an account. Token withheld from response and logs.');
  return res.json(generic);
}

/** POST /api/auth/reset — { token, password } */
export async function resetPassword(req, res) {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '');
  if (!token) return res.status(400).json({ message: 'Reset token is required' });
  if (password.length < 8) return res.status(400).json({ message: 'Password must be at least 8 characters' });

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now() || !record.user?.isActive) {
    return res.status(400).json({ message: 'Reset token is invalid, already used, or expired' });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash: await hashPassword(password) } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  // Already-issued JWTs cannot be enumerated from the token store, so they expire
  // naturally; changing the password means all *future* logins require the new
  // credential and any future logout/revoke still works via jti.
  await logAudit({
    userId: record.userId, action: 'PASSWORD_RESET', entityType: 'User', entityId: record.userId,
    details: { note: 'Password changed; existing JWTs expire naturally, future logins require the new password.' }, req,
  });
  res.json({ message: 'Password has been reset. Please log in with your new password.' });
}
