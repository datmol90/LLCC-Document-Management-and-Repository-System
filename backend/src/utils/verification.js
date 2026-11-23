import { createHash, randomBytes } from 'crypto';

/**
 * Generates a short, human-transcribable, URL-safe verification code.
 * Format: 3 groups, e.g. LLCC-8F3K-2QZ9-4M7T
 */
export function generateVerificationCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const bytes = randomBytes(9);
  const groups = [];
  for (let g = 0; g < 3; g++) {
    let s = '';
    for (let i = 0; i < 3; i++) s += alphabet[bytes[g * 3 + i] % alphabet.length];
    groups.push(s);
  }
  return `LLCC-${groups.join('-')}`;
}

export function normalizeVerificationCode(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim().toUpperCase().replace(/\s+/g, '');
  if (trimmed.startsWith('LLCC')) return trimmed;
  return `LLCC-${trimmed}`;
}

/** Stable fingerprint used to detect backup tampering/corruption. */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
