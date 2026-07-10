# STATUS — What's built, what's stubbed, what to test first

_Generated at build time. Everything below was exercised end-to-end against a live
PostgreSQL and Meta channels in **dry-run** (no real tokens yet)._

---

## TL;DR

This is a **working product**, not scaffolding. Backend + frontend + DB + webhook +
all seven doc features are implemented and were smoke-tested this session. Every
outbound message routes through one §9A choke point. An adversarial multi-agent audit
of the ban-prevention found **one** real concurrency defect (Instagram cap race), which
was **fixed and re-verified**.

---

## ✅ Fully working (verified this session)

| Area | Status | How it was verified |
|---|---|---|
| Auth (JWT, Admin/Agent roles) | ✅ | Login returns token; `/auth/me`; agent blocked from `/reports` (403) |
| Unified inbox (list + filters + channels) | ✅ | 5 seeded conversations across WhatsApp/IG/Messenger listed |
| Webhook `GET` verify | ✅ | Correct token echoes challenge; wrong token → 403 |
| Webhook `POST` ingest + normalize | ✅ | Simulated WhatsApp inbound created customer + conversation + message |
| Webhook dedupe (retry-safe) | ✅ | Re-posting same message id → no duplicate |
| **§9A 24h window** | ✅ | In-window free-form allowed; out-of-window free-form **blocked (422)** |
| **§9A templates** | ✅ | Approved template sent out-of-window; **unapproved template blocked** |
| **§9A opt-in / no cold send** | ✅ | Reply to never-messaged WhatsApp → **blocked** (initiate needs template) |
| **§9A Instagram hourly cap** | ✅ | Reserve-before-send; 10 concurrent vs cap 3 → exactly 3 (race fixed) |
| AI agent (offline-only) + human takeover | ✅ | AI auto-replied when all agents offline; takeover set OPEN + kept full history |
| Multi-agent claim (atomic) | ✅ | Agent claimed; second claim by another → **409 conflict** |
| Red-flag engine | ✅ | Seeded 32-min-unanswered conversation auto-flagged (threshold 15m) |
| Appointment booking + overlap prevention | ✅ | Booked; identical slot → **DOUBLE_BOOKING** rejected |
| Customer profiles & history | ✅ | Profile drawer with identities, opt-in toggle, notes, appts, history |
| Reporting dashboard | ✅ | `/reports/overview` returns volume, response time, bookings, agent status |
| Realtime (Socket.IO) | ✅ | Presence drives AI offline logic; inbox/thread live-update events wired |
| Frontend build | ✅ | `vite build` → 87 modules, 0 errors |
| GSAP + theming (§6) | ✅ | Tokens, stagger/modal/drawer/pulse/count-up/scroll, `prefers-reduced-motion` |

---

## 🟡 Partial / stubbed — and exactly why

| Item | State | Why / what's needed to finish |
|---|---|---|
| **Real Meta sends** | Dry-run (logs, no real DM) | Paste `WHATSAPP_ACCESS_TOKEN` / `FB_PAGE_ACCESS_TOKEN` into `server/.env`. Each channel auto-switches to live when its token is present. |
| **Webhook registration in Meta** | Not done (needs panel) | Dev has no Business-Manager access. Expose via ngrok/cloudflared and give **Truji** the callback URL + verify token to register (§9, §11). |
| **Webhook signature check** | Skipped when `META_APP_SECRET` empty | Set `META_APP_SECRET` and it enforces HMAC-SHA256 automatically. |
| **AI via real Claude** | Mock replies now | Set `ANTHROPIC_API_KEY`; provider auto-upgrades to `claude-sonnet-5`. Mock is a working stand-in. |
| **Production WhatsApp number** | Test number assumed | 90-day/5-recipient test number; register a real business number before launch (§13). Use `WHATSAPP_TEST_RECIPIENTS` allowlist meanwhile. |
| **WhatsApp templates** | 2 seeded as APPROVED locally | Real templates must be created + approved in WhatsApp Manager; mirror their names in the `message_templates` table. |
| **Email/SMTP (Resend)** | Not built | Doc §11 says "not decided yet." No code assumes it. Add when confirmed. |
| **Doctor availability** | Seeded Mon–Fri 9–13/14–18 | Real per-doctor schedules to be entered (Admin → doctors API exists; UI for editing schedules not built). |

---

## 🧭 Recommended testing order (do these in sequence)

1. **Boot** — `docker compose up -d` → `npm run setup` → `npm run dev`. Sign in as admin.
2. **Inbox + in-window reply** — open "Lucía Fernández" (WhatsApp), send a free-form reply. Watch the green "24h window open" badge; message appears (dry-run).
3. **Webhook + AI** — with everyone signed out (all agents offline), POST a fake inbound (see README / the curl below). Confirm a new conversation appears **and** the AI auto-replied. Then sign in and **Take over from AI** — verify full history + handoff marker.
4. **§9A blocks (the important part)** — open "Roberto Díaz" (out-of-window): free-form is disabled, sending is blocked; pick the approved `appointment_reminder` template → it sends. Open "Prospecto Anónimo" (never messaged) → any send blocked.
5. **Red-flag** — "Gabriela Soto" is pre-flagged (32 min unanswered). Lower the threshold in Admin and watch new ones flag live.
6. **Appointments** — book from a conversation ("📅 Book"); try the same doctor/slot twice → conflict blocked.
7. **Multi-agent** — open two browsers (admin + sofia). Claim a conversation in one; the other sees it claimed / gets 409 on claim.
8. **Dashboard** (admin) — metrics count up; message-volume + channel bars; ScrollTrigger reveal.
9. **Go-live** — paste real creds into `server/.env`, restart, have Truji register the webhook, submit real templates, swap to the production number. Keep the Meta app in **Dev mode** until sign-off (§9A, §13).

Quick inbound-webhook curl (dry-run friendly):
```bash
curl -X POST http://localhost:3000/webhook -H "Content-Type: application/json" -d '{
 "object":"whatsapp_business_account",
 "entry":[{"changes":[{"value":{
   "messaging_product":"whatsapp","metadata":{"phone_number_id":"PNID"},
   "contacts":[{"wa_id":"5215511112222","profile":{"name":"Test Patient"}}],
   "messages":[{"from":"5215511112222","id":"wamid.demo1","timestamp":"1720000000","type":"text","text":{"body":"Hola!"}}]}}]}]
}'
```

---

## 🔒 §9A ban-prevention audit result

A 6-lens adversarial workflow (find → independently verify) attacked the messaging core:
choke-point integrity, 24h window, opt-in, rate-limit, AI agent, and templates.

- **Choke-point, window, opt-in, AI-agent, template lenses: clean** (no reachable bypass).
- **1 CONFIRMED defect (now fixed):** the Instagram hourly cap was a check-then-act race —
  a webhook batch firing several AI/human sends to different IG conversations could all read
  a stale count and overshoot Meta's ~200/hr limit. **Fix:** slots are now **reserved atomically
  before sending** under a Postgres advisory lock (`reserveInstagramSlot`), released if the send
  fails. Re-verified: 10 concurrent reservations against a cap of 3 grant exactly 3.
- 2 candidate findings were **rejected** on verification (template-channel mismatch and
  unfilled-placeholder rendering are content-quality issues, not §9A send-authorization breaks).
  Both are noted as optional hardening below.

---

## ⚠️ Deviations from the doc (flagged, per your rule)

- **Data model additions** (schema comments mark each): `Conversation.lastInboundAt` &
  `lastOutboundAt`, `Customer.optedIn`/`optInAt`, new `ChannelIdentity`, `MessageTemplate`,
  `OutboundLog`, `Setting`. All exist to make §9A enforceable + the app runnable. Core 6 doc
  entities are intact.
- **Reporting is Admin-only** — matches the doc §4 matrix assumption ("assumed Admin-only; confirm").
  Flip in `server/src/routes/reports.js` if agents should see it.
- **Messenger/Instagram "template"** — those channels have no WhatsApp-style templates; out-of-window
  re-engagement is modeled as a **message tag** (ACCOUNT_UPDATE / HUMAN_AGENT) through the same guard
  interface. Confirm the tags you're approved to use.
- **Instagram send endpoint** uses the IG-scoped `/{IG_BUSINESS_ACCOUNT_ID}/messages` with the Page
  token (Method A). Easy to swap if your setup expects `/me/messages`.

## 🧰 Optional hardening (not blocking)

- Validate a template's `channel` against the conversation's channel before sending.
- Warn/reject when a template still contains unfilled `{{n}}` placeholders after rendering.

---

## ❓ Still needs YOUR decision (doc §13)

- AI provider/model confirmation (currently Anthropic + mock fallback).
- Real WhatsApp production number timing/ownership.
- Go-live criteria to flip the Meta app Dev → Live.
- Which WhatsApp templates to draft + submit for approval.
- Compliance regime for patient data (HIPAA / local) — not yet addressed anywhere in code.
- Red-flag threshold value (defaulted to 15 min; configurable in Admin).
- Whether doctors need their own login/role (currently a scheduling resource only).
