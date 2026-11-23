import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export const hashPassword = async (password) => bcrypt.hash(password, 10);
export const comparePassword = async (password, hash) => bcrypt.compare(password, hash);

export const signToken = (user) => {
  return jwt.sign(
    // jti gives every issued token a stable unique id that logout/reset can revoke.
    { id: user.id, role: user.role, departmentId: user.departmentId, email: user.email, name: user.name, jti: randomUUID() },
    process.env.JWT_SECRET || 'dev_secret',
    { expiresIn: '8h' }
  );
};

export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET || 'dev_secret');
