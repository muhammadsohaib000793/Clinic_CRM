// Simulate a PATIENT messaging the clinic's Facebook Page (Messenger) — posts to
// the webhook exactly like Meta would.
//
// Usage (from the project root):
//   node server/scripts/messenger.mjs "your message" ["Patient Name"] [psid]
// Examples:
//   node server/scripts/messenger.mjs "Hi, how much is a cleaning?"
//   node server/scripts/messenger.mjs "book a dental cleaning Monday 10am" "Ana Perez"
//
// Same name continues the same conversation; a different name starts a new one.
import '../src/config/env.js';
import { env } from '../src/config/env.js';
import crypto from 'node:crypto';

const msg = process.argv[2];
const name = process.argv[3] || 'FB Patient';
const idFromName = (n) =>
  parseInt(crypto.createHash('sha256').update(`fb${n.toLowerCase().trim()}`).digest('hex').slice(0, 12), 16).toString();
const psid = (process.argv[4] || idFromName(name)).replace(/\D/g, '');

if (!msg) {
  console.error('Usage: node server/scripts/messenger.mjs "message" ["Name"] [psid]');
  process.exit(1);
}

const pageId = env.meta.pageId || 'PAGEID';
const payload = {
  object: 'page',
  entry: [{
    id: pageId,
    time: Date.now(),
    messaging: [{
      sender: { id: psid, name },
      recipient: { id: pageId },
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
console.log(`[Messenger] "${name}" (PSID ${psid}) messaged the WeEvolveit page:`);
console.log(`   "${msg}"`);
console.log(`   -> webhook responded ${res.status}. Watch the CRM inbox (Messenger channel).`);
