// Simulate a PATIENT texting the clinic — posts to the webhook exactly like Meta
// would when a real patient messages. Lets you test the whole patient flow now.
//
// Usage (from the project root):
//   node server/scripts/patient.mjs "your message" ["Patient Name"] [number]
// Examples:
//   node server/scripts/patient.mjs "Hola, quiero una cita para limpieza dental el lunes a las 10am"
//   node server/scripts/patient.mjs "How much is a consultation?" "Maria Lopez"
//
// Re-run with the SAME name/number to continue the same conversation (a back-and-forth).
import '../src/config/env.js';
import { env } from '../src/config/env.js';
import crypto from 'node:crypto';

const msg = process.argv[2];
const name = process.argv[3] || 'Test Patient';
// The default number is derived from the NAME, so a different name creates a
// different conversation, and the same name continues the same one.
const numberFromName = (n) => {
  const h = crypto.createHash('sha256').update(n.toLowerCase().trim()).digest('hex');
  return '52155' + (parseInt(h.slice(0, 10), 16) % 100000000).toString().padStart(8, '0');
};
const number = (process.argv[4] || numberFromName(name)).replace(/\D/g, '');

if (!msg) {
  console.error('Usage: node server/scripts/patient.mjs "message" ["Name"] [number]');
  process.exit(1);
}

const ts = Math.floor(Date.now() / 1000);
const payload = {
  object: 'whatsapp_business_account',
  entry: [{ changes: [{ value: {
    messaging_product: 'whatsapp',
    metadata: { phone_number_id: 'PNID' },
    contacts: [{ wa_id: number, profile: { name } }],
    messages: [{ from: number, id: `wamid.sim.${Date.now()}`, timestamp: `${ts}`, type: 'text', text: { body: msg } }],
  } }] }],
};

const raw = JSON.stringify(payload);
const headers = { 'Content-Type': 'application/json' };
// Sign the request so the webhook (with a real App Secret) accepts it.
if (env.meta.appSecret) {
  headers['X-Hub-Signature-256'] = 'sha256=' + crypto.createHmac('sha256', env.meta.appSecret).update(raw).digest('hex');
}

const res = await fetch(`http://localhost:${env.port}/webhook`, { method: 'POST', headers, body: raw });
console.log(`📲 Patient "${name}" (${number}) texted the clinic:`);
console.log(`   "${msg}"`);
console.log(`   → webhook responded ${res.status}. Now watch the CRM inbox at http://localhost:5173`);
