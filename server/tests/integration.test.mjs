// End-to-end integration tests against a RUNNING backend (default :3000).
// Run with:  npm --workspace server run test   (server must be up + freshly seeded)
// Uses Node's built-in test runner — no extra dependencies.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3000';

let adminToken;
let sofiaToken; // owns the seeded Andrés (Instagram) conversation
let diegoToken; // a different agent, for cross-agent tests
let rfConvId; // shared between the red-flag tests

async function req(path, { method = 'GET', body, token } = {}) {
  // API routes live under /api; the Meta webhook sits at the root.
  const url = BASE + (path.startsWith('/webhook') ? path : `/api${path}`);
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

// Retry a probe until it returns truthy (for the async webhook pipeline).
async function waitFor(fn, { tries = 20, delay = 200 } = {}) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, delay));
  }
  return null;
}

let __seq = 0;
const uniq = () => `${Date.now()}${(__seq++).toString().padStart(4, '0')}`; // collision-proof within a run
const newWaId = () => `521${uniq()}`; // unique numeric WhatsApp id (length is not validated)

function waPayload({ waId, name, text, tsSecondsAgo = 0, msgId }) {
  const ts = Math.floor(Date.now() / 1000) - tsSecondsAgo;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              metadata: { phone_number_id: 'PNID' },
              contacts: [{ wa_id: waId, profile: { name } }],
              messages: [{ from: waId, id: msgId || `wamid.${uniq()}`, timestamp: `${ts}`, type: 'text', text: { body: text } }],
            },
          },
        ],
      },
    ],
  };
}
function pagePayload({ object, psid, text, msgId }) {
  return {
    object, // 'page' (Messenger) or 'instagram'
    entry: [
      {
        messaging: [
          {
            sender: { id: psid },
            recipient: { id: 'PAGEID' },
            timestamp: Date.now(),
            message: { mid: msgId || `mid.${uniq()}`, text },
          },
        ],
      },
    ],
  };
}

async function listConversations(token, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const { data } = await req(`/conversations${qs ? `?${qs}` : ''}`, { token });
  return data.conversations;
}
async function findConversationByName(token, name) {
  const list = await listConversations(token);
  return list.find((c) => c.customer?.name === name);
}

before(async () => {
  const a = await req('/auth/login', { method: 'POST', body: { email: 'admin@weevolveit.mx', password: 'Admin123!' } });
  assert.equal(a.status, 200, 'admin login should succeed — is the server running and seeded?');
  adminToken = a.data.token;
  const s = await req('/auth/login', { method: 'POST', body: { email: 'sofia@weevolveit.mx', password: 'Agent123!' } });
  sofiaToken = s.data.token;
  const d = await req('/auth/login', { method: 'POST', body: { email: 'diego@weevolveit.mx', password: 'Agent123!' } });
  diegoToken = d.data.token;
});

// ------------------------------ AUTH & RBAC ---------------------------------
test('AUTH-01 login with valid credentials returns token + role', async () => {
  const { status, data } = await req('/auth/login', { method: 'POST', body: { email: 'admin@weevolveit.mx', password: 'Admin123!' } });
  assert.equal(status, 200);
  assert.ok(data.token);
  assert.equal(data.agent.role, 'ADMIN');
});
test('AUTH-02 login with wrong password is rejected 401', async () => {
  const { status } = await req('/auth/login', { method: 'POST', body: { email: 'admin@weevolveit.mx', password: 'nope' } });
  assert.equal(status, 401);
});
test('AUTH-03 /auth/me returns the current agent', async () => {
  const { status, data } = await req('/auth/me', { token: sofiaToken });
  assert.equal(status, 200);
  assert.equal(data.agent.email, 'sofia@weevolveit.mx');
});
test('AUTH-04 protected route without token is 401', async () => {
  const { status } = await req('/conversations');
  assert.equal(status, 401);
});
test('AUTH-05 agent is forbidden from admin-only reports (403)', async () => {
  const { status } = await req('/reports/overview', { token: sofiaToken });
  assert.equal(status, 403);
});

// ------------------------------ WEBHOOK -------------------------------------
test('WH-01 GET verify echoes challenge for correct token', async () => {
  const res = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=weevolveit_dev_2026&hub.challenge=ABC123`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'ABC123');
});
test('WH-02 GET verify rejects wrong token (403)', async () => {
  const res = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=X`);
  assert.equal(res.status, 403);
});
test('WH-03 WhatsApp inbound creates customer + conversation + message', async () => {
  const waId = newWaId();
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'WA Ingest', text: 'Hola WA' }) });
  const conv = await waitFor(async () => findConversationByName(adminToken, 'WA Ingest'));
  assert.ok(conv, 'conversation should be created');
  assert.equal(conv.channel, 'WHATSAPP');
});
test('WH-04 Messenger inbound normalizes to MESSENGER channel', async () => {
  const psid = `psid_${uniq()}`;
  await req('/webhook', { method: 'POST', body: pagePayload({ object: 'page', psid, text: 'Hi FB' }) });
  const conv = await waitFor(async () => {
    const list = await listConversations(adminToken, { channel: 'MESSENGER' });
    return list.find((c) => c.channel === 'MESSENGER');
  });
  assert.ok(conv, 'a MESSENGER conversation should exist');
});
test('WH-05 Instagram inbound normalizes to INSTAGRAM channel', async () => {
  const psid = `igsid_${uniq()}`;
  await req('/webhook', { method: 'POST', body: pagePayload({ object: 'instagram', psid, text: 'Hi IG' }) });
  const conv = await waitFor(async () => {
    const list = await listConversations(adminToken, { channel: 'INSTAGRAM' });
    return list.length > 0;
  });
  assert.ok(conv);
});
test('WH-06 duplicate message id is deduped (no second inbound)', async () => {
  const waId = newWaId();
  const msgId = `wamid.dedupe.${uniq()}`;
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'WA Dedupe', text: 'once', msgId }) });
  const conv = await waitFor(async () => findConversationByName(adminToken, 'WA Dedupe'));
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'WA Dedupe', text: 'once', msgId }) });
  await new Promise((r) => setTimeout(r, 600));
  const { data } = await req(`/conversations/${conv.id}`, { token: adminToken });
  const inbound = data.conversation.messages.filter((m) => m.senderType === 'CUSTOMER');
  assert.equal(inbound.length, 1, 'exactly one customer inbound after duplicate delivery');
});

// ------------------------------ §9A CORE ------------------------------------
test('9A-01 in-window free-form reply is ALLOWED', async () => {
  const lucia = await findConversationByName(adminToken, 'Lucía Fernández');
  const { status, data } = await req(`/conversations/${lucia.id}/reply`, { method: 'POST', token: adminToken, body: { content: 'Yes, this week works!' } });
  assert.equal(status, 200);
  assert.equal(data.mode, 'FREE_FORM');
});
test('9A-02 out-of-window free-form is BLOCKED (422)', async () => {
  const roberto = await findConversationByName(adminToken, 'Roberto Díaz');
  const { status, data } = await req(`/conversations/${roberto.id}/reply`, { method: 'POST', token: adminToken, body: { content: 'ping' } });
  assert.equal(status, 422);
  assert.match(data.error.reason, /outside_24h_window/);
});
test('9A-03 out-of-window APPROVED template is ALLOWED', async () => {
  const roberto = await findConversationByName(adminToken, 'Roberto Díaz');
  const { status, data } = await req(`/conversations/${roberto.id}/reply`, { method: 'POST', token: adminToken, body: { templateName: 'appointment_reminder', templateParams: ['Roberto', 'Dr. Ana Ruiz'] } });
  assert.equal(status, 200);
  assert.equal(data.mode, 'TEMPLATE');
});
test('9A-04 UNAPPROVED template is BLOCKED', async () => {
  const roberto = await findConversationByName(adminToken, 'Roberto Díaz');
  const { status, data } = await req(`/conversations/${roberto.id}/reply`, { method: 'POST', token: adminToken, body: { templateName: 'reengage_followup', templateParams: ['Roberto'] } });
  assert.equal(status, 422);
  assert.match(data.error.reason, /template_not_approved/);
});
test('9A-05 nonexistent template is BLOCKED', async () => {
  const roberto = await findConversationByName(adminToken, 'Roberto Díaz');
  const { status, data } = await req(`/conversations/${roberto.id}/reply`, { method: 'POST', token: adminToken, body: { templateName: 'does_not_exist' } });
  assert.equal(status, 422);
  assert.match(data.error.reason, /template_not_found/);
});
test('9A-06 cold send to not-opted-in customer is BLOCKED', async () => {
  const prospecto = await findConversationByName(adminToken, 'Prospecto Anónimo');
  const { status, data } = await req(`/conversations/${prospecto.id}/reply`, { method: 'POST', token: adminToken, body: { content: 'hello' } });
  assert.equal(status, 422);
  assert.match(data.error.reason, /whatsapp_initiate_requires_template|not_opted_in/);
});
test('9A-07 empty free-form is BLOCKED', async () => {
  const lucia = await findConversationByName(adminToken, 'Lucía Fernández');
  const { status } = await req(`/conversations/${lucia.id}/reply`, { method: 'POST', token: adminToken, body: { content: '   ' } });
  assert.equal(status, 422);
});
test('9A-08 policy-preview reports window + decision without sending', async () => {
  const roberto = await findConversationByName(adminToken, 'Roberto Díaz');
  const { status, data } = await req(`/conversations/${roberto.id}/policy-preview?content=hi`, { token: adminToken });
  assert.equal(status, 200);
  assert.equal(data.window.open, false);
  assert.equal(data.decision.allowed, false);
});

// ------------------------ CONVERSATIONS / ASSIGNMENT ------------------------
test('CONV-01 claim assigns, second claim by another agent -> 409', async () => {
  const waId = newWaId();
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'Claim Race', text: 'hi' }) });
  const conv = await waitFor(async () => findConversationByName(adminToken, 'Claim Race'));
  const first = await req(`/conversations/${conv.id}/claim`, { method: 'POST', token: sofiaToken });
  assert.equal(first.status, 200);
  assert.equal(first.data.conversation.assignedAgent.name, 'Sofia Martinez');
  const second = await req(`/conversations/${conv.id}/claim`, { method: 'POST', token: diegoToken });
  assert.equal(second.status, 409);
});
test('CONV-02 reply auto-claims an unassigned conversation', async () => {
  const waId = newWaId();
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'AutoClaim', text: 'hola' }) });
  const conv = await waitFor(async () => findConversationByName(sofiaToken, 'AutoClaim'));
  const { status } = await req(`/conversations/${conv.id}/reply`, { method: 'POST', token: sofiaToken, body: { content: 'Hi, how can we help?' } });
  assert.equal(status, 200);
  const { data } = await req(`/conversations/${conv.id}`, { token: sofiaToken });
  assert.equal(data.conversation.assignedAgent.name, 'Sofia Martinez');
});
test('CONV-03 non-owner agent cannot reply (403)', async () => {
  // Self-contained: fresh conversation, Sofia claims it, Diego (non-owner) is blocked.
  const waId = newWaId();
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'Owner Test', text: 'hi' }) });
  const conv = await waitFor(async () => findConversationByName(adminToken, 'Owner Test'));
  await req(`/conversations/${conv.id}/claim`, { method: 'POST', token: sofiaToken });
  const { status } = await req(`/conversations/${conv.id}/reply`, { method: 'POST', token: diegoToken, body: { content: 'butting in' } });
  assert.equal(status, 403);
});
test('CONV-04 admin can reassign a conversation', async () => {
  const andres = await findConversationByName(adminToken, 'Andrés Peña');
  const agents = (await req('/agents', { token: adminToken })).data.agents;
  const diego = agents.find((a) => a.email === 'diego@weevolveit.mx');
  const { status, data } = await req(`/conversations/${andres.id}/assign`, { method: 'POST', token: adminToken, body: { agentId: diego.id } });
  assert.equal(status, 200);
  assert.equal(data.conversation.assignedAgent.id, diego.id);
});
test('CONV-05 close then reopen toggles status', async () => {
  const conv = await findConversationByName(adminToken, 'Andrés Peña');
  let r = await req(`/conversations/${conv.id}/close`, { method: 'POST', token: adminToken });
  assert.equal(r.data.conversation.status, 'CLOSED');
  r = await req(`/conversations/${conv.id}/reopen`, { method: 'POST', token: adminToken });
  assert.equal(r.data.conversation.status, 'OPEN');
});

// ------------------------------ AI + TAKEOVER -------------------------------
test('AI-01 AI auto-replies when all agents offline, then human takeover preserves history', async (t) => {
  const online = (await req('/reports/overview', { token: adminToken })).data.agents.filter((a) => a.status === 'ONLINE');
  if (online.length > 0) {
    t.skip(`an agent is ONLINE (${online.map((a) => a.name).join(',')}) — AI coverage is suppressed by design; close browser sessions to test`);
    return;
  }
  const waId = newWaId();
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'AI Coverage', text: 'Hola, cuanto cuesta?' }) });
  const conv = await waitFor(async () => {
    const c = await findConversationByName(adminToken, 'AI Coverage');
    if (!c) return null;
    const d = await req(`/conversations/${c.id}`, { token: adminToken });
    const ai = d.data.conversation.messages.filter((m) => m.senderType === 'AI');
    return ai.length > 0 ? c : null;
  });
  assert.ok(conv, 'AI should have replied');
  const take = await req(`/conversations/${conv.id}/takeover`, { method: 'POST', token: sofiaToken });
  assert.equal(take.status, 200);
  assert.equal(take.data.conversation.status, 'OPEN');
  const sys = take.data.conversation.messages.filter((m) => m.senderType === 'SYSTEM');
  assert.ok(sys.length >= 1, 'a handoff marker should be added');
  const customer = take.data.conversation.messages.filter((m) => m.senderType === 'CUSTOMER');
  assert.ok(customer.length >= 1, 'full history preserved after takeover');
});

// ------------------------------ RED-FLAG ------------------------------------
test('RF-01 scan flags a conversation unanswered past threshold', async () => {
  // Self-contained: an inbound from >24h ago. AI cannot free-form outside the
  // window, so it stays unanswered and OPEN -> the scanner must flag it.
  const waId = newWaId();
  await req('/webhook', { method: 'POST', body: waPayload({ waId, name: 'RedFlag Fixture', text: 'anyone there?', tsSecondsAgo: 25 * 3600 }) });
  const conv = await waitFor(async () => findConversationByName(adminToken, 'RedFlag Fixture'));
  assert.ok(conv);
  rfConvId = conv.id;
  const scan = await req('/redflag/scan', { method: 'POST', token: adminToken });
  assert.equal(scan.status, 200);
  const after = await req(`/conversations/${rfConvId}`, { token: adminToken });
  assert.equal(after.data.conversation.status, 'FLAGGED');
});
test('RF-02 replying clears the red flag', async () => {
  // Reply with an approved template (allowed outside the window) -> flag clears.
  const r = await req(`/conversations/${rfConvId}/reply`, { method: 'POST', token: adminToken, body: { templateName: 'hello_world' } });
  assert.equal(r.status, 200);
  const after = await req(`/conversations/${rfConvId}`, { token: adminToken });
  assert.notEqual(after.data.conversation.status, 'FLAGGED');
});

// ------------------------------ APPOINTMENTS --------------------------------
function nextWeekdayAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 3); // a few days out
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}
test('APPT-01 book a valid appointment (CONFIRMED)', async () => {
  const doctors = (await req('/doctors', { token: adminToken })).data.doctors;
  const cust = (await req('/customers', { token: adminToken })).data.customers[0];
  // Try 9:00 on successive future weekdays until a free slot books — robust to
  // whatever appointments already exist from prior runs.
  let booked = null;
  for (let d = 14; d < 30 && !booked; d++) {
    const when = new Date();
    when.setDate(when.getDate() + d);
    if (when.getDay() === 0 || when.getDay() === 6) continue;
    when.setHours(9, 0, 0, 0);
    const r = await req('/appointments', { method: 'POST', token: adminToken, body: { doctorId: doctors[0].id, customerId: cust.id, scheduledAt: when.toISOString(), durationMinutes: 30, reason: 'test' } });
    if (r.status === 201) booked = r.data.appointment;
  }
  assert.ok(booked, 'a slot should book on one of the tried weekdays');
  assert.equal(booked.status, 'CONFIRMED');
});
test('APPT-02 double-booking the same slot is BLOCKED (DOUBLE_BOOKING)', async () => {
  const doctors = (await req('/doctors', { token: adminToken })).data.doctors;
  const cust = (await req('/customers', { token: adminToken })).data.customers[0];
  const when = nextWeekdayAt(11);
  when.setMinutes((Math.floor(Math.random() * 4) + 6) * 30 % 60);
  const body = { doctorId: doctors[1].id, customerId: cust.id, scheduledAt: when.toISOString(), durationMinutes: 30 };
  const first = await req('/appointments', { method: 'POST', token: adminToken, body });
  assert.equal(first.status, 201);
  const second = await req('/appointments', { method: 'POST', token: adminToken, body });
  assert.equal(second.status, 409);
  assert.equal(second.data.error.details.code, 'DOUBLE_BOOKING');
});
test('APPT-03 booking in the past is rejected (400)', async () => {
  const doctors = (await req('/doctors', { token: adminToken })).data.doctors;
  const cust = (await req('/customers', { token: adminToken })).data.customers[0];
  const past = new Date(Date.now() - 3600_000).toISOString();
  const { status } = await req('/appointments', { method: 'POST', token: adminToken, body: { doctorId: doctors[0].id, customerId: cust.id, scheduledAt: past } });
  assert.equal(status, 400);
});
test('APPT-04 booking outside availability is rejected (409 OUTSIDE_AVAILABILITY)', async () => {
  const doctors = (await req('/doctors', { token: adminToken })).data.doctors;
  const cust = (await req('/customers', { token: adminToken })).data.customers[0];
  const when = nextWeekdayAt(3); // 03:00 — outside 9-18
  const { status, data } = await req('/appointments', { method: 'POST', token: adminToken, body: { doctorId: doctors[0].id, customerId: cust.id, scheduledAt: when.toISOString() } });
  assert.equal(status, 409);
  assert.equal(data.error.details.code, 'OUTSIDE_AVAILABILITY');
});
test('APPT-05 doctor slots endpoint returns availability grid', async () => {
  const doctors = (await req('/doctors', { token: adminToken })).data.doctors;
  const date = nextWeekdayAt(9).toISOString().slice(0, 10);
  const { status, data } = await req(`/doctors/${doctors[0].id}/slots?date=${date}`, { token: adminToken });
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.slots) && data.slots.length > 0);
});
test('APPT-06 cancel sets status CANCELLED', async () => {
  const doctors = (await req('/doctors', { token: adminToken })).data.doctors;
  const cust = (await req('/customers', { token: adminToken })).data.customers[0];
  const when = nextWeekdayAt(14);
  when.setMinutes(30);
  const booked = await req('/appointments', { method: 'POST', token: adminToken, body: { doctorId: doctors[2].id, customerId: cust.id, scheduledAt: when.toISOString() } });
  const id = booked.data.appointment.id;
  const { status, data } = await req(`/appointments/${id}/cancel`, { method: 'POST', token: adminToken });
  assert.equal(status, 200);
  assert.equal(data.appointment.status, 'CANCELLED');
});

// ------------------------------ CUSTOMERS -----------------------------------
test('CUST-01 list + search customers', async () => {
  const all = (await req('/customers', { token: adminToken })).data.customers;
  assert.ok(all.length >= 5);
  const search = (await req('/customers?search=Roberto', { token: adminToken })).data.customers;
  assert.ok(search.some((c) => c.name.includes('Roberto')));
});
test('CUST-02 get profile with history', async () => {
  const cust = (await req('/customers?search=Andrés', { token: adminToken })).data.customers[0];
  const { status, data } = await req(`/customers/${cust.id}`, { token: adminToken });
  assert.equal(status, 200);
  assert.ok(Array.isArray(data.customer.conversations));
  assert.ok(Array.isArray(data.customer.identities));
});
test('CUST-03 update notes and opt-in toggle', async () => {
  const cust = (await req('/customers?search=Prospecto', { token: adminToken })).data.customers[0];
  let r = await req(`/customers/${cust.id}`, { method: 'PATCH', token: adminToken, body: { notes: 'called back', optedIn: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.customer.optedIn, true);
  r = await req(`/customers/${cust.id}`, { method: 'PATCH', token: adminToken, body: { optedIn: false } });
  assert.equal(r.data.customer.optedIn, false);
});

// ------------------------------ DOCTORS / ADMIN -----------------------------
test('DOC-01 list doctors', async () => {
  const { data } = await req('/doctors', { token: adminToken });
  assert.ok(data.doctors.length >= 3);
});
test('DOC-02 agent cannot create a doctor (403)', async () => {
  const { status } = await req('/doctors', { method: 'POST', token: sofiaToken, body: { name: 'Dr. Nope' } });
  assert.equal(status, 403);
});
test('AGENT-01 admin creates agent, it can log in, then is deleted', async () => {
  const email = `test_${uniq()}@weevolveit.mx`;
  const created = await req('/agents', { method: 'POST', token: adminToken, body: { name: 'Temp Agent', email, password: 'Temp123!', role: 'AGENT' } });
  assert.equal(created.status, 201);
  const login = await req('/auth/login', { method: 'POST', body: { email, password: 'Temp123!' } });
  assert.equal(login.status, 200);
  const del = await req(`/agents/${created.data.agent.id}`, { method: 'DELETE', token: adminToken });
  assert.equal(del.status, 200);
});
test('AGENT-02 agent cannot create agents (403)', async () => {
  const { status } = await req('/agents', { method: 'POST', token: sofiaToken, body: { name: 'x', email: `x${uniq()}@e.mx`, password: 'x' } });
  assert.equal(status, 403);
});

// ------------------------------ SETTINGS ------------------------------------
test('SET-01 get settings includes red-flag threshold', async () => {
  const { data } = await req('/settings', { token: adminToken });
  assert.ok(Number.isFinite(data.redflagThresholdMinutes));
});
test('SET-02 admin updates threshold; agent cannot', async () => {
  const forbidden = await req('/settings/redflag-threshold', { method: 'PUT', token: sofiaToken, body: { minutes: 30 } });
  assert.equal(forbidden.status, 403);
  const ok = await req('/settings/redflag-threshold', { method: 'PUT', token: adminToken, body: { minutes: 20 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.redflagThresholdMinutes, 20);
  await req('/settings/redflag-threshold', { method: 'PUT', token: adminToken, body: { minutes: 15 } }); // restore
});

// ------------------------------ REPORTS / STATUS ----------------------------
test('REP-01 overview returns messages, conversations, appointments, agents', async () => {
  const { status, data } = await req('/reports/overview', { token: adminToken });
  assert.equal(status, 200);
  assert.ok(data.messages && typeof data.messages.total === 'number');
  assert.ok(Array.isArray(data.agents));
  assert.ok(data.responseTime);
});
test('REP-02 message-volume series is an array', async () => {
  const { data } = await req('/reports/message-volume', { token: adminToken });
  assert.ok(Array.isArray(data.series));
});
test('STATUS-01 status reports dry-run map + AI provider', async () => {
  const { status, data } = await req('/status', { token: adminToken });
  assert.equal(status, 200);
  assert.ok('WHATSAPP' in data.channels);
  assert.ok(['anthropic', 'mock'].includes(data.aiProvider));
});
test('TPL-01 templates list includes seeded templates', async () => {
  const { data } = await req('/templates', { token: adminToken });
  const names = data.templates.map((t) => t.name);
  assert.ok(names.includes('appointment_reminder'));
  assert.ok(names.includes('reengage_followup'));
});
