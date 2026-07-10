# WeEvolveit CRM — Unified Messaging & Appointments

A custom clinic CRM that consolidates patient messaging (WhatsApp, Instagram, Facebook
Messenger) and doctor appointment booking into one platform, with an after-hours AI agent
and Meta ban-prevention (§9A) enforced in code on **every** outbound message path.

Built per `Custom-CRM-Technical-Documentation.md`. Stack: **React + Vite + GSAP** frontend,
**Node/Express + Socket.IO + Prisma** backend, **PostgreSQL**, **Meta Graph API v21.0**,
AI via **Anthropic Claude** (with automatic mock fallback).

---

## Prerequisites

- Node.js ≥ 18 (tested on Node 24)
- Docker Desktop (for the bundled PostgreSQL) — or your own PostgreSQL
- (Optional) An Anthropic API key for the real AI agent; without it the AI uses deterministic mock replies
- (Optional) Real Meta/Kainos credentials; without them every channel runs in **dry-run** (logs instead of calling Meta)

---

## Quick start

```bash
# 1. Install everything (root uses npm workspaces)
npm install

# 2. Start PostgreSQL
docker compose up -d          # or:  npm run db:up

# 3. Create your env file (dev values, no real secrets needed to boot)
cp .env.example server/.env    # then edit server/.env as needed
#   The active env file the server + Prisma read is  server/.env

# 4. Generate client, run migration, seed demo data
npm run setup                  # = db:generate + db:migrate + db:seed

# 5. Run backend + frontend together
npm run dev
#   backend  -> http://localhost:3000
#   frontend -> http://localhost:5173
```

Open http://localhost:5173 and sign in:

| Role  | Email                     | Password   |
|-------|---------------------------|------------|
| Admin | admin@weevolveit.mx       | Admin123!  |
| Agent | sofia@weevolveit.mx       | Agent123!  |

> **Where does `.env` live?** In `server/.env` (Prisma CLI and the server both resolve it there).
> `.env.example` at the repo root is the template. Both are git-ignored except the example.

---

## Filling in real credentials (`.env`)

Every variable is documented in `.env.example`. Paste your real Kainos/Meta values into
`server/.env`. Leave anything blank to keep that piece in a safe mode:

- **No `WHATSAPP_ACCESS_TOKEN`** → WhatsApp sends are **dry-run** (logged, not sent).
- **No `FB_PAGE_ACCESS_TOKEN`** → Messenger + Instagram sends are dry-run.
- **No `META_APP_SECRET`** → webhook signature verification is **skipped** (dev only).
- **No `ANTHROPIC_API_KEY`** → AI agent uses deterministic **mock** replies.
- **`WHATSAPP_TEST_RECIPIENTS`** → comma-separated allowlist enforced during the test phase.

Never commit `server/.env`. Rotate the Kainos-handoff tokens after go-live (see doc §13).

---

## §9A ban-prevention (the core safety property)

There is exactly **one** function that talks to Meta: `sendGuard.send()`
(`server/src/services/messaging/sendGuard.js`). Every path — agent reply, AI auto-reply,
appointment confirmation, re-engagement — routes through it. It enforces, in order:

1. Recipient channel identity must exist.
2. **24-hour window**: inside → free-form allowed; outside → **approved template only**.
3. **Opt-in** required for out-of-window / business-initiated sends (no cold/unsolicited).
4. Template must exist **and be APPROVED**.
5. **WhatsApp test-recipient allowlist** (when configured).
6. **Instagram rolling hourly cap** (`INSTAGRAM_HOURLY_DM_CAP`, default 180 < Meta's ~200).
7. No empty free-form content.

Every decision (ALLOWED/BLOCKED + reason) is written to the `outbound_logs` table for audit.
The AI agent has **no privileged path** — it obeys all of the above and only fires when every
agent is offline.

---

## Webhook (Meta)

- `GET /webhook` — verification handshake (uses `WEBHOOK_VERIFY_TOKEN`).
- `POST /webhook` — inbound receiver (HMAC-signature verified when `META_APP_SECRET` is set).

For local dev, expose the backend with a tunnel and give **Truji** (the only Business-Manager
panel holder) the callback URL to register:

```bash
ngrok http 3000        # -> https://xxxx.ngrok-free.app/webhook
# verify token: weevolveit_dev_2026 (matches server/.env)
```

Subscribe fields: WhatsApp `messages`; Messenger `messages`,`messaging_postbacks`; Instagram `messages`.

---

## Project structure

```
server/
  prisma/schema.prisma        # 6 doc entities + §9A additions (see comments)
  src/
    services/messaging/       # ⭐ sendGuard + windowPolicy + rateLimiter + templates + channels
    services/ai/              # Anthropic + mock providers, offline-only agentRunner
    services/{conversations,appointments,customers,reporting,redflag,settings,agents}/
    webhook/                  # verify + receive + normalize + signature
    realtime/                 # Socket.IO server + event emitter
    routes/ middleware/ config/ lib/
client/
  src/
    pages/                    # Login, Inbox, Customers, Appointments, Dashboard, Admin
    components/               # ConversationList/Thread, MessageComposer, CustomerDrawer, BookingModal
    context/                  # Auth, Socket, Toast
    animations/gsap.js        # §6 timings/easings, respects prefers-reduced-motion
    theme/tokens.css          # §6 design tokens (light theme + dark remap)
```

---

## Useful scripts

| Command | What |
|---|---|
| `npm run dev` | Run backend + frontend concurrently |
| `npm run dev:server` / `dev:client` | Run one side |
| `npm run setup` | generate + migrate + seed |
| `npm run seed` | Re-seed demo data |
| `npm --workspace server run db:studio` | Prisma Studio (browse the DB) |
| `npm --workspace server run db:reset` | Drop + recreate + reseed |

See `STATUS.md` for what's fully working, what's stubbed, and the recommended testing order.
