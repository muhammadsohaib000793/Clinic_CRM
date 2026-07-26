# Deploy to Railway

One Railway service runs everything — the API, the Meta webhook, and the built React UI.
The repo is already configured (`railway.json` + `build`/`start` scripts).

## 1. Create the project
1. Go to **railway.com** → **New Project** → **Deploy from GitHub repo**.
2. Pick **`muhammadsohaib000793/Clinic_CRM`** (authorize Railway to access it if asked).
3. Railway detects Node and uses `railway.json` automatically:
   - **Build:** `npm run build` (builds the React app + generates the Prisma client)
   - **Start:** runs DB migrations, seeds the demo/admin data, then starts the server

## 2. Add the database
1. In the project → **New** → **Database** → **PostgreSQL**.
2. Railway creates a `DATABASE_URL`. In your **app service → Variables**, add:
   `DATABASE_URL = ${{Postgres.DATABASE_URL}}`  *(reference the Postgres service)*

## 3. Set environment variables (app service → Variables)
Paste your real values from the handoff (never commit them):
```
NODE_ENV=production
JWT_SECRET=<a long random string>
WEBHOOK_VERIFY_TOKEN=weevolveit_dev_2026

WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_WABA_ID=...
WHATSAPP_ACCESS_TOKEN=...
GRAPH_API_VERSION=v21.0

META_APP_ID=...
META_APP_SECRET=...
FB_PAGE_ID=...
FB_PAGE_ACCESS_TOKEN=...
IG_BUSINESS_ACCOUNT_ID=...

AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=        # optional; mock replies used if empty
AI_MODEL=claude-sonnet-5

# leave empty for real sending; set to "true" for a safe demo (no real sends)
MESSAGING_DRY_RUN=
# fill these AFTER step 4 gives you the public URL:
PUBLIC_BASE_URL=https://<your-app>.up.railway.app
CLIENT_ORIGIN=https://<your-app>.up.railway.app
```
*(Railway sets `PORT` automatically — the app already uses it.)*

## 4. Get the public URL
App service → **Settings → Networking → Generate Domain** → e.g.
`https://clinic-crm-production.up.railway.app`
- Then set `PUBLIC_BASE_URL` and `CLIENT_ORIGIN` (step 3) to this URL and redeploy.

## 5. Open it
Visit the domain → the CRM loads. Log in with **admin@weevolveit.mx / Admin123!**
(the seed creates the admin + demo data on first deploy).

## 6. The webhook
Your webhook URL is:
```
https://<your-app>.up.railway.app/webhook
```
Verify token: `weevolveit_dev_2026`. Send both to **Truji** to register in Meta
(WhatsApp → Configuration; Messenger/Instagram → Webhooks; subscribe field `messages`).
See `LIVE-SETUP.md` for the full go-live steps.

---

### Notes
- Migrations + seed run on each deploy (idempotent — safe).
- Keep the Meta app in **Development mode** until go-live sign-off.
- **Rotate the tokens** after go-live (they travelled through chat/email).
- For local dev, nothing changes — keep using `npm run dev` (Vite on :5173).
