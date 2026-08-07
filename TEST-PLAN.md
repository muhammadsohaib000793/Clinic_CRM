# Test Plan & Test Cases

## Did I test everything? — Honest answer

**Backend / business logic: yes, comprehensively.** Four independent layers of testing:

1. **46 automated integration tests** (`server/tests/integration.test.mjs`) — **all passing**.
   Run with `npm test`. They hit the real running server + real PostgreSQL and cover every
   feature area (auth, all 3 channels' webhook ingestion, the full §9A matrix, claim/assign/
   takeover, red-flag, appointments + overlap, customers, agents, settings, reporting).
2. **Manual API smoke tests** during the build (curl/PowerShell) — the same flows, by hand.
3. **A 9-agent adversarial security audit** of the §9A ban-prevention (6 attack lenses + independent
   verification). It found **one** real concurrency bug (Instagram cap race), which was **fixed and
   re-verified** (10 concurrent sends vs a cap of 3 → exactly 3 succeed).
4. **Frontend production build** (`vite build`) — compiles clean, 0 errors.

**What is NOT automatically tested (and why):**

- **Real message delivery to Meta** — everything runs in **dry-run** until real tokens are added,
  so I can verify the *decision + persistence + policy*, but not that a real WhatsApp/IG/FB message
  physically arrives. That requires live credentials (a manual step, listed below).
- **Interactive UI clicks** — the frontend is build-verified and its API calls are the same ones the
  automated tests exercise, but literal button-clicking is a **manual** checklist (UI-01…UI-12 below).
  Walk those in the browser.

---

## How to run the automated tests

```bash
# 1. Backend must be running against a freshly seeded DB:
docker compose up -d
npm run setup            # migrate + seed  (first time only)
npm run dev:server       # leave running in one terminal

# 2. In a second terminal:
npm test                 # -> 46 passing
```

> Tests are self-contained where it matters, but for a 100% clean run start from a fresh seed
> (`npm --workspace server run db:reset`) — integration tests mutate data by design.

---

## Automated test cases (46) — all passing

| ID | Area | What it verifies |
|---|---|---|
| AUTH-01 | Auth | Valid login returns token + role |
| AUTH-02 | Auth | Wrong password → 401 |
| AUTH-03 | Auth | `/auth/me` returns current agent |
| AUTH-04 | Auth | Protected route without token → 401 |
| AUTH-05 | RBAC | Agent blocked from admin-only reports → 403 |
| WH-01 | Webhook | GET verify echoes challenge for correct token |
| WH-02 | Webhook | GET verify rejects wrong token → 403 |
| WH-03 | Webhook | WhatsApp inbound creates customer + conversation + message |
| WH-04 | Webhook | Messenger inbound normalizes to MESSENGER |
| WH-05 | Webhook | Instagram inbound normalizes to INSTAGRAM |
| WH-06 | Webhook | Duplicate message id deduped (retry-safe) |
| **9A-01** | **§9A** | In-window free-form reply **ALLOWED** |
| **9A-02** | **§9A** | Out-of-window free-form **BLOCKED (422)** |
| **9A-03** | **§9A** | Out-of-window approved template **ALLOWED** |
| **9A-04** | **§9A** | Unapproved template **BLOCKED** |
| **9A-05** | **§9A** | Nonexistent template **BLOCKED** |
| **9A-06** | **§9A** | Cold send to non-opted-in **BLOCKED** |
| **9A-07** | **§9A** | Empty free-form **BLOCKED** |
| **9A-08** | **§9A** | Policy-preview reports window + decision (no send) |
| CONV-01 | Inbox | Claim assigns; second claim by another agent → 409 |
| CONV-02 | Inbox | Reply auto-claims an unassigned conversation |
| CONV-03 | Inbox | Non-owner agent cannot reply → 403 |
| CONV-04 | Inbox | Admin can reassign a conversation |
| CONV-05 | Inbox | Close then reopen toggles status |
| AI-01 | AI | AI auto-replies when all agents offline; takeover preserves full history |
| RF-01 | Red-flag | Scan flags an unanswered conversation past threshold |
| RF-02 | Red-flag | Replying clears the red flag |
| APPT-01 | Scheduling | Book a valid appointment → CONFIRMED |
| APPT-02 | Scheduling | Double-booking same slot → 409 DOUBLE_BOOKING |
| APPT-03 | Scheduling | Booking in the past → 400 |
| APPT-04 | Scheduling | Booking outside availability → 409 OUTSIDE_AVAILABILITY |
| APPT-05 | Scheduling | Doctor slots endpoint returns availability grid |
| APPT-06 | Scheduling | Cancel sets status CANCELLED |
| CUST-01 | Customers | List + search |
| CUST-02 | Customers | Profile with full history |
| CUST-03 | Customers | Update notes + opt-in toggle |
| DOC-01 | Doctors | List doctors |
| DOC-02 | RBAC | Agent cannot create a doctor → 403 |
| AGENT-01 | Admin | Admin creates agent → it can log in → delete |
| AGENT-02 | RBAC | Agent cannot create agents → 403 |
| SET-01 | Settings | Settings include red-flag threshold |
| SET-02 | Settings | Admin updates threshold; agent forbidden |
| REP-01 | Reporting | Overview returns messages/convos/appts/agents |
| REP-02 | Reporting | Message-volume series is an array |
| STATUS-01 | Ops | Status reports dry-run map + AI provider |
| TPL-01 | Templates | Template list includes seeded templates |

---

## Manual UI test cases (walk these in the browser)

Sign in at http://localhost:5173. These mirror the automated backend tests at the UI level.

| ID | Steps | Expected |
|---|---|---|
| UI-01 | Log in as admin | Lands on Inbox; sidebar shows Dashboard + Admin (admin only) |
| UI-02 | Open **Lucía** (WhatsApp), Claim, send a reply | Green "window open" badge; message appears (dry-run) |
| UI-03 | Open **Roberto** (out-of-window) | Free-form box disabled; template picker shown |
| UI-04 | Send `appointment_reminder` template to Roberto | Sends; no block |
| UI-05 | Open **Prospecto**, try to send | Red "Blocked by ban-prevention" toast |
| UI-06 | Filter **🚩 Flagged** | **Gabriela** appears red-bordered; sidebar badge shows count |
| UI-07 | Reply to Gabriela | Flag clears live |
| UI-08 | Any conversation → **📅 Book** → pick doctor/day/slot | Appointment created; visible on Appointments page |
| UI-09 | Book the same slot again | "That slot was just taken" error |
| UI-10 | Conversation → **Profile** | Drawer slides in: identities, opt-in, notes, history |
| UI-11 | Sign out → (ask Claude to inject an inbound) → sign in → open it → **Take over from AI** | AI reply present; 🤝 handoff marker; full history |
| UI-12 | Dashboard (admin) | Metrics count up; volume + channel bars; agent presence |

---

## Not yet covered (future work, needs live creds or new build)

- Real end-to-end message delivery through Meta (needs tokens + webhook registered by Truji).
- Meta **status** webhooks (delivered/read/failed receipts) — not implemented.
- Media/attachment messages — text only today.
- Load / soak testing at real message volume.
- Automated frontend (Playwright) UI tests — currently manual (UI-01…UI-12).
