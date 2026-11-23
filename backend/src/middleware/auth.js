import { verifyToken } from '../utils/auth.js';
import prisma from '../utils/prisma.js';

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try {
    const payload = verifyToken(token);
    if (payload.jti) {
      const revoked = await prisma.revokedToken.findUnique({ where: { id: payload.jti } });
      if (revoked) return res.status(401).json({ message: 'Token has been revoked' });
    }
    const user = await prisma.user.findUnique({ where: { id: payload.id }, include: { department: true } });
    if (!user || !user.isActive) return res.status(401).json({ message: 'Invalid or inactive account' });
    req.user = user;
    req.token = token;
    req.tokenPayload = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ message: 'Insufficient permissions' });
    next();
  };
}
