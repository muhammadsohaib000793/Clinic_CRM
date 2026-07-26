// Simulate a PATIENT DMing the clinic's Instagram (@weevolveit) — posts to the
// webhook exactly like Meta would.
//
// Usage (from the project root):
//   node server/scripts/instagram.mjs "your message" ["Patient Name"] [igsid]
// Examples:
//   node server/scripts/instagram.mjs "Do you do teeth whitening?"
//   node server/scripts/instagram.mjs "book with Dr. Ana on Tuesday at 3pm" "Sofia IG"
//
// Same name continues the same conversation; a different name starts a new one.
import '../src/config/env.js';
import { env } from '../src/config/env.js';
import crypto from 'node:crypto';

const msg = process.argv[2];
const name = process.argv[3] || 'IG Patient';
const idFromName = (n) =>
  parseInt(crypto.createHash('sha256').update(`ig${n.toLowerCase().trim()}`).digest('hex').slice(0, 12), 16).toString();
const igsid = (process.argv[4] || idFromName(name)).replace(/\D/g, '');

if (!msg) {
  console.error('Usage: node server/scripts/instagram.mjs "message" ["Name"] [igsid]');
  process.exit(1);
}

const igId = env.meta.igBusinessAccountId || 'IGID';
const payload = {
  object: 'instagram',
  entry: [{
    id: igId,
    time: Date.now(),
    messaging: [{
      sender: { id: igsid, name },
      recipient: { id: igId },
      timestamp: Date.now(),
      message: { mid: `mid.sim.${Date.now()}`, text: msg },
    }],
  }],
};

const raw = JSON.stringify(payload);
const headers = { 'Content-Type': 'application/json' };
if (env.meta.appSecret) {
  headers['X-Hub-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', env.meta.appSecret).update(raw).digest('hex');
}

const res = await fetch(`http://localhost:${env.port}/webhook`, { method: 'POST', headers, body: raw });
console.log(`[Instagram] "${name}" (IGSID ${igsid}) DMed @weevolveit:`);
console.log(`   "${msg}"`);
console.log(`   -> webhook responded ${res.status}. Watch the CRM inbox (Instagram channel).`);
