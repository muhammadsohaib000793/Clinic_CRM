# Going Live — setup for the panel-holder (Truji)

The application is complete and tested. To make **real** WhatsApp/Instagram/Messenger
messaging work (send, receive, and book with confirmations), a few **Meta-panel** steps are
required. These need Business-Manager / App-Dashboard access, so they are done by Truji.

Everything below was already **proven working up to Meta's account gate** — the app sends a real
Graph API call with a valid token; Meta only blocks recipients/webhooks that haven't been
authorized in the panel yet (e.g. error `131030 Recipient not in allowed list`).

---

## What the developer already did
- Full app built + **53/53 automated tests passing**.
- §9A ban-prevention enforced on every send (24h window, opt-in, approved templates, IG cap).
- Live token confirmed working (real WhatsApp API call reached Meta and was accepted for a
  verified recipient).

## What Truji needs to do (≈10 minutes)

### 1. Verify the test recipient numbers
**WhatsApp → API Setup → "To" field → Manage phone number list → Add number.**
Add each phone you'll test with (e.g. the dev's `+92 305 559 8916`). Meta sends a code via
WhatsApp; enter it. *(Test phase: max 5 verified recipients.)*
Then add those same numbers to `WHATSAPP_TEST_RECIPIENTS` in `server/.env` (digits, comma-separated).

### 2. Create + approve the message templates
**WhatsApp Manager → Message Templates.** `hello_world` already exists (Meta default). Create and
submit any others you need for out-of-window re-engagement / booking confirmations, e.g.
`appointment_reminder` with body `Hi {{1}}, this is a reminder of your appointment with {{2}}.`
Once **APPROVED**, make sure the same name exists in the app's `message_templates` table (the
Admin → Templates screen shows current status).

### 3. Expose the app + register the webhook
```bash
# with the app running (npm run dev):
ngrok http 3000            # -> https://xxxx.ngrok-free.app
```
Give the callback URL `https://xxxx.ngrok-free.app/webhook` and verify token `weevolveit_dev_2026`
to register in Meta:
- **WhatsApp → Configuration → Webhook** → subscribe field: `messages`
- **Messenger → Webhooks** → subscribe: `messages`, `messaging_postbacks`
- **Instagram → Webhooks** → subscribe: `messages`

Meta will call `GET /webhook` to verify — the app answers automatically.

---

## The real end-to-end test (after steps 1–3)

**WhatsApp (two-way):**
1. From a *verified* phone, send a WhatsApp to the test number **+1 555 161 4692**.
2. ✅ It appears in the CRM **Inbox** in real time (green "24h window open" badge).
3. Reply from the CRM → ✅ it arrives on the phone.
4. In that chat click **📅 Book** → pick doctor/day/slot → **Confirm** → ✅ appointment created.
   *(To also send the patient a confirmation outside the 24h window, use an approved template.)*
5. Or text *"book a dental cleaning Monday 10am"* while all agents are offline → ✅ the **AI books it**
   and replies with the confirmation.

**Instagram / Messenger:**
- DM **@weevolveit** (Instagram) or message the **WeEvolveit** page (Messenger) from an account with
  an app role → ✅ appears in the inbox → reply from the CRM.

---

## Notes
- Keep the Meta app in **Development mode** until go-live sign-off (avoids bans).
- The permanent tokens travelled through chat/email — **rotate them after go-live** (regenerate the
  System User token, Page token, and App Secret).
- For a **local UI demo** without real sending, set `MESSAGING_DRY_RUN=true` in `server/.env` so
  the seeded demo conversations send cleanly (fake numbers won't hit Meta's allowlist).
- Production later: real business WhatsApp number, host on Render/Railway, point `bot.kainos.mx`.
