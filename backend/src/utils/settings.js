import prisma from './prisma.js';

/** Defaults are always merged into API responses so a fresh install works. */
export const DEFAULT_SETTINGS = {
  expiryReminderDays: [30, 14, 7, 3, 1],
  backupEnabled: false,
  backupIntervalHours: 24,
  maxFileSizeMB: 20,
  aiEnabled: false,
};

/** Validation rules for PUT /api/settings. */
export const SETTING_RULES = {
  expiryReminderDays: {
    validate: (v) => Array.isArray(v) && v.length >= 1 && v.length <= 12 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 365),
    message: 'expiryReminderDays must be an array of 1-12 integers between 0 and 365',
  },
  backupEnabled: { validate: (v) => typeof v === 'boolean', message: 'backupEnabled must be a boolean' },
  backupIntervalHours: { validate: (v) => Number.isFinite(v) && v >= 1 && v <= 720, message: 'backupIntervalHours must be between 1 and 720' },
  maxFileSizeMB: { validate: (v) => Number.isFinite(v) && v >= 1 && v <= 1000, message: 'maxFileSizeMB must be between 1 and 1000' },
  aiEnabled: { validate: (v) => typeof v === 'boolean', message: 'aiEnabled must be a boolean' },
  expiryScanHours: { validate: (v) => Number.isFinite(v) && v >= 1 && v <= 720, message: 'expiryScanHours must be between 1 and 720' },
};

/** Settings values are strings in SQLite; structured values are stored as JSON. */
export function serializeSettingValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function parseSettingValue(key, raw) {
  if (raw === undefined || raw === null) return DEFAULT_SETTINGS[key];
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Returns merged settings (defaults + persisted overrides). */
export async function getSettings() {
  const rows = await prisma.setting.findMany();
  const stored = {};
  for (const row of rows) stored[row.key] = parseSettingValue(row.key, row.value);
  return { ...DEFAULT_SETTINGS, ...stored };
}

/** Convenience accessor used by schedulers and middleware. */
export async function getSetting(key, fallback) {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row ? parseSettingValue(key, row.value) : fallback;
  } catch {
    return fallback;
  }
}

/** Persists a partial settings object; returns the merged result. */
export async function setSettings(values) {
  for (const [key, value] of Object.entries(values)) {
    await prisma.setting.upsert({
      where: { key },
      update: { value: serializeSettingValue(value) },
      create: { key, value: serializeSettingValue(value) },
    });
  }
  return getSettings();
}
