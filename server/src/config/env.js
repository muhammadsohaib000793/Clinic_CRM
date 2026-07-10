// Loads and normalizes environment variables. Missing Meta credentials are NOT
// fatal — the messaging channels fall back to DRY-RUN so the app is testable
// before real secrets are pasted into `.env` (§13: user fills .env themselves).
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../../');       // server/
const projectRoot = path.resolve(__dirname, '../../../');   // project root

// Prefer a project-root .env, then server/.env — either placement works.
for (const candidate of [path.join(projectRoot, '.env'), path.join(serverRoot, '.env')]) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

const bool = (v, fallback = false) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};
const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${int(process.env.PORT, 3000)}`,
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  databaseUrl: process.env.DATABASE_URL || '',
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-change-me',

  // Messaging safety
  messagingDryRunForced: process.env.MESSAGING_DRY_RUN, // undefined => per-channel auto
  whatsappTestRecipients: list(process.env.WHATSAPP_TEST_RECIPIENTS),
  instagramHourlyCap: int(process.env.INSTAGRAM_HOURLY_DM_CAP, 180),
  redflagThresholdMinutes: int(process.env.REDFLAG_THRESHOLD_MINUTES, 15),

  graphApiVersion: process.env.GRAPH_API_VERSION || 'v21.0',

  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    wabaId: process.env.WHATSAPP_WABA_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
  },
  meta: {
    appId: process.env.META_APP_ID || '',
    appSecret: process.env.META_APP_SECRET || '',
    pageId: process.env.FB_PAGE_ID || '',
    pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN || '',
    igBusinessAccountId: process.env.IG_BUSINESS_ACCOUNT_ID || '',
  },
  webhookVerifyToken: process.env.WEBHOOK_VERIFY_TOKEN || '',

  ai: {
    provider: (process.env.AI_PROVIDER || 'anthropic').toLowerCase(),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-sonnet-5',
  },

  isDryRunForced: bool(process.env.MESSAGING_DRY_RUN, false),
  dryRunExplicit: process.env.MESSAGING_DRY_RUN !== undefined && process.env.MESSAGING_DRY_RUN !== '',
};

// A concise startup report of what's configured (never prints secret values).
export function envReport() {
  const has = (v) => (v ? 'set' : 'MISSING');
  return {
    nodeEnv: env.nodeEnv,
    port: env.port,
    database: env.databaseUrl ? 'set' : 'MISSING',
    jwtSecret: env.jwtSecret === 'dev-insecure-change-me' ? 'DEFAULT (insecure)' : 'set',
    webhookVerifyToken: has(env.webhookVerifyToken),
    graphApiVersion: env.graphApiVersion,
    whatsapp: {
      phoneNumberId: has(env.whatsapp.phoneNumberId),
      accessToken: has(env.whatsapp.accessToken),
      testRecipients: env.whatsappTestRecipients.length,
    },
    meta: {
      appSecret: has(env.meta.appSecret),
      pageAccessToken: has(env.meta.pageAccessToken),
      igBusinessAccountId: has(env.meta.igBusinessAccountId),
    },
    instagramHourlyCap: env.instagramHourlyCap,
    ai: { provider: env.ai.provider, key: has(env.ai.anthropicApiKey), model: env.ai.model },
  };
}
