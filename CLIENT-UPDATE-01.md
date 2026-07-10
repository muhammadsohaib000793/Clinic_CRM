# Project Update #1 — Custom CRM & Unified Messaging Platform

**Date:** 10 July 2026
**Prepared for:** Kainos / WeEvolveit
**Phase:** Discovery complete · Core Build in progress

---

Hi team,

Here's the first progress update on your custom CRM and unified messaging platform. We're
tracking well against the phased plan from the proposal. Summary below, then the detail.

## Where we are against the plan

| Phase | Scope | Status |
|---|---|---|
| **1 — Discovery** | Requirements, workflow mapping, integration approach | ✅ **Complete** |
| **2 — Core Build** | Unified inbox, multi-agent replies, channel integrations | 🟢 **In progress — foundations working** |
| **3 — Scheduling** | Appointment booking + overlap prevention | 🟡 Early groundwork started |
| **4 — AI & Alerts** | AI agent + human takeover, red-flag alerts, dashboard | 🟡 Early groundwork started |
| **5 — Testing & Launch** | QA, data setup, training, go-live | ⏳ Not started |

## What's been achieved so far

**Discovery is done.** We've locked the technical approach: a single web platform (accessible on
desktop and mobile) that brings WhatsApp, Instagram, and Facebook Messenger into one inbox, with
doctor appointment booking built in. We confirmed the Meta integration path using the credentials
Truji provided, and mapped exactly how messages will flow in and out of the system.

**Core Build is underway and the backbone is functioning in our development environment:**

- A unified inbox that pulls conversations from all three channels into one place.
- Your five agents can work from the same dashboard, with conversations that can be claimed and
  assigned so two people never reply to the same chat.
- A first working version of the appointment booking logic that prevents double-booking a doctor.
- Early versions of the after-hours AI assistant and the "unanswered message" red-flag alerts.

**A key priority — protecting your Meta accounts from bans — is built into the core, not bolted on.**
Per our discovery discussion, this is the single biggest operational risk, so every outgoing message
is checked against Meta's rules (the 24-hour reply window, approved-template requirement, opt-in
only, no bulk/cold messages, and Instagram's hourly limit) **before** it can ever be sent. We've
tested this extensively.

## What we'll need from you in the coming phase

To keep momentum through Core Build into Scheduling and Launch, we'll need:

1. **The real WhatsApp business number** (the current one is Meta's 90-day test number, limited to
   5 recipients) — please confirm timing and ownership.
2. **Message templates** you want for re-engaging patients outside the 24-hour window — these must be
   submitted to Meta for approval, and approval takes time, so the sooner we draft them the better.
3. **Confirmation of the go-live criteria** — we'll keep the Meta app in safe "development mode" until
   you sign off, specifically to avoid any risk to the account.
4. A short note on **patient-data handling requirements** (any local healthcare privacy rules we
   should design around).

## Next steps (our side)

- Continue hardening the channel integrations and the multi-agent inbox.
- Progress the scheduling and AI-agent phases.
- Prepare a walkthrough so you can see the working system for yourselves.

We're happy with the pace and the foundations are solid. I'll follow up with the next update as we
move further into Core Build and Scheduling.

Best regards,
[Your name]
