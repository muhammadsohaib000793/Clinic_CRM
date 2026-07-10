import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { SETTING_KEYS } from '../../config/constants.js';

export async function getSetting(key, fallback = null) {
  const s = await prisma.setting.findUnique({ where: { key } });
  return s ? s.value : fallback;
}

export async function setSetting(key, value) {
  return prisma.setting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });
}

export async function getRedflagThresholdMinutes() {
  const v = await getSetting(SETTING_KEYS.REDFLAG_THRESHOLD_MINUTES, String(env.redflagThresholdMinutes));
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : env.redflagThresholdMinutes;
}

export async function getAllSettings() {
  const rows = await prisma.setting.findMany();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
