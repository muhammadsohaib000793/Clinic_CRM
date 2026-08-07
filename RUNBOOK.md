# RUNBOOK — How to run and check this project (from zero)

This guide assumes you know **nothing** about the project. Follow it top to bottom.
Everything is copy-paste. You're on **Windows**, so we use **PowerShell**.

---

## 0. What this project is (30 seconds)

Two programs that run together on your computer:

- **Backend** (the "brain") — talks to WhatsApp/Instagram/Facebook, stores data, enforces the
  anti-ban rules. Runs at `http://localhost:3000`.
- **Frontend** (the "screen") — the website your agents use. Runs at `http://localhost:5173`.
- **Database** (PostgreSQL) — where everything is saved. Runs inside **Docker**.

You open the **frontend** in your browser and log in. That's the app.

---

## 1. Install the three things you need (one time)

1. **Node.js** (version 18 or newer) → https://nodejs.org → download the "LTS" installer → run it,
   click Next until done.
2. **Docker Desktop** → https://www.docker.com/products/docker-desktop → install → **launch it**
   and wait until its whale icon says "running." (This runs the database for you.)
3. That's it. You do **not** need to install PostgreSQL yourself — Docker handles it.

**Check they're installed.** Open PowerShell (press Start, type "PowerShell", Enter) and run:

```powershell
node -v
docker -v
```

You should see version numbers. If "node is not recognized," restart your computer after installing.

---

## 2. Open a terminal in the project folder

In PowerShell, go to the project folder (adjust the path if yours differs):

```powershell
cd "C:\Users\DEV\Desktop\Proj\CRM\CRM Project"
```

You should now be "inside" the project. Everything below is run from here.

---

## 3. First-time setup (only needed once)

Run these **in order**. Wait for each to finish before the next.

```powershell
# 3a. Install the code libraries (takes a couple of minutes)
npm install

# 3b. Create your settings file (safe placeholder values; no real passwords yet)
Copy-Item ".env.example" "server\.env"

# 3c. Start the database (Docker Desktop must be running first!)
docker compose up -d

# 3d. Create the database tables and load demo data
npm run setup
```

If step 3d ends with **"Seed complete: 1 admin, 5 agents…"**, setup worked. 🎉

---

## 4. Start the app (every time you want to use it)

```powershell
# make sure the database is up (safe to run again)
docker compose up -d

# start backend + frontend together
npm run dev
```

Leave that window open (it keeps the app running). You'll see log lines scrolling.

Now open your browser to **http://localhost:5173** and log in:

| Role  | Email                 | Password  |
|-------|-----------------------|-----------|
| Admin | admin@weevolveit.mx   | Admin123! |
| Agent | sofia@weevolveit.mx   | Agent123! |

**To stop the app:** click the PowerShell window and press **Ctrl + C**.

---

## 5. Check that everything works (two ways)

### A) Automatic tests (fastest confidence check)

Open a **second** PowerShell window in the same folder (repeat step 2), then:

```powershell
# Make sure the app is running (step 4) and data is fresh:
npm --workspace server run db:reset      # resets to clean demo data
npm run dev:server                       # (or keep 'npm run dev' running from step 4)

# In the second window, run the tests:
npm test
```

You should see **`pass 46` / `fail 0`**. That confirms the whole backend works.

### B) Walk the screens yourself

Follow the **Manual UI test cases (UI-01 … UI-12)** in `TEST-PLAN.md`. In short:
1. Log in → you're on the **Inbox**.
2. Open **Lucía**, click **Claim**, type a reply → it appears.
3. Open **Roberto** → notice free-form is disabled and a **template** picker appears (that's the
   anti-ban rule working).
4. Open **Prospecto** → any send is **blocked** (no cold messages).
5. Tick the **🚩 Flagged** filter → **Gabriela** shows (unanswered too long).
6. In any chat click **📅 Book** → book an appointment; try the same slot twice → blocked.
7. (Admin) open **Dashboard** and **Admin**.

---

## 6. Handy commands

| I want to… | Command |
|---|---|
| Start the database | `docker compose up -d` |
| Start the app (backend + frontend) | `npm run dev` |
| Start only the backend | `npm run dev:server` |
| Start only the frontend | `npm run dev:client` |
| Reset demo data to clean state | `npm --workspace server run db:reset` |
| Run the automated tests | `npm test` |
| Browse the database visually | `npm --workspace server run db:studio` |
| Stop the app | Ctrl + C in its window |
| Stop the database | `docker compose down` |

---

## 7. When you're ready to go LIVE (later)

Right now the app is in **safe dry-run mode** — it logs messages instead of really sending them, so
nothing can reach real patients or risk your Meta account. To connect it for real:

1. Open `server\.env` in a text editor.
2. Paste your real Meta values (from Truji) next to the matching names — the file explains each one.
   (`WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`, `FB_PAGE_ACCESS_TOKEN`, etc.)
3. Save, then restart the app (Ctrl + C, then `npm run dev`).
4. Ask Truji to register the webhook URL in Meta (you don't have that access; he does).

See `README.md` and `STATUS.md` for the full go-live checklist. **Never share the `.env` file** —
it holds passwords.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `docker ... cannot find ... pipe/dockerDesktop` | Docker Desktop isn't running — open it, wait for "running," retry. |
| `Port 3000 (or 5173) already in use` | The app is already running in another window, or close it: find the window and Ctrl+C. |
| Login says "invalid" | Data not seeded — run `npm run setup` (first time) or `npm --workspace server run db:reset`. |
| `npm test` all fail with 404 / connection refused | The backend isn't running — start it (step 4) first. |
| Page won't load at :5173 | The frontend isn't running — run `npm run dev` and wait for "Local: http://localhost:5173". |
| Want a totally clean start | `docker compose down` then repeat step 3c–3d. |

---

## 9. Where the important pieces live (for reference)

- `server/.env` — your secret settings (never commit/share).
- `server/prisma/schema.prisma` — the database structure.
- `server/src/services/messaging/sendGuard.js` — **the anti-ban rules** (every message passes here).
- `server/src/webhook/` — receives messages from Meta.
- `client/src/pages/` — the screens (Inbox, Customers, Appointments, Dashboard, Admin).
- `README.md` — technical overview. `STATUS.md` — what's done / what's left. `TEST-PLAN.md` — tests.
