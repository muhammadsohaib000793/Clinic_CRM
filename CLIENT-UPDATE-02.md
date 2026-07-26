# Project Update #2 — Custom CRM & Unified Messaging Platform

**Date:** 17 July 2026
**Prepared for:** Kainos / WeEvolveit
**Phase:** Core Build complete & in testing · Scheduling and AI in working preview

---

Hi team,

Following up on Update #1 — good progress to report. The core of the platform is now built
and working end-to-end in our development environment, and I've attached **screenshots of the
live system** so you can see it for yourselves.

## Where we are against the plan

| Phase | Scope | Status |
|---|---|---|
| **1 — Discovery** | Requirements, workflow mapping, integration approach | ✅ Complete |
| **2 — Core Build** | Unified inbox, multi-agent replies, channel integrations | ✅ **Built — now in internal testing** |
| **3 — Scheduling** | Appointment booking + overlap prevention | 🟢 **Working preview** |
| **4 — AI & Alerts** | AI agent + human takeover, red-flag alerts, dashboard | 🟢 **Working preview** |
| **5 — Testing & Launch** | QA, data setup, training, go-live | ⏳ Preparing |

## What's new since Update #1

The system you can see in the attached screenshots now does the following:

- **One unified inbox** that brings WhatsApp, Instagram, and Facebook Messenger conversations
  into a single view, updating in **real time** as messages arrive.
- **Multi-agent workflow** — your five agents can claim and reply to conversations from the same
  dashboard, with safeguards so two agents never reply to the same chat.
- **Appointment booking** built into each conversation, with live doctor availability and
  automatic **prevention of double-bookings**.
- **After-hours AI assistant** that answers patients when the team is offline, with **one-click
  handover to a human agent** that preserves the full conversation history.
- **Red-flag alerts** that automatically highlight any patient message left unanswered too long,
  so nothing slips through.
- **Admin dashboard** showing message volume, response times, appointments booked, and which
  agents are online.

## Protecting your Meta accounts (your top priority)

As agreed in discovery, avoiding account bans is the number one concern — so every single
outgoing message is checked against Meta's rules (the 24-hour reply window, approved-template
requirement, opt-in only, and the Instagram sending limit) **before** it can be sent. We've
built an automated test suite specifically around these rules, and it is currently passing in
full. The AI assistant is held to the exact same rules.

## About the attached screenshots

These are from our **development environment running with sample patient data**. Live message
sending is **intentionally switched off** until we go live together, so nothing in this preview
touches real patients or your Meta account — it's a safe, working demonstration of the workflow.

## What we still need from you

To move from Core Build into Testing & Launch, we'll need:

1. **The real WhatsApp business number** (the current test number is time-limited).
2. **The message templates** you want for contacting patients outside the 24-hour window — these
   need Meta's approval, which takes time, so earlier is better.
3. **Sign-off on go-live criteria** — we're keeping the Meta app in safe "development mode" until
   you're ready.
4. **Your patient-data handling requirements** (any local healthcare privacy rules to design around).

## Next steps (our side)

- Complete an internal QA pass and finish refining the scheduling and AI features.
- Connect your real Meta credentials as soon as they're available.
- Prepare the go-live checklist and a short training session for the team.

We're pleased with how it's coming together. Happy to walk you through a live demo whenever suits.

Best regards,
[Your name]
