# Message for Truji (register the webhook in Meta)

> Replace `<YOUR-RAILWAY-URL>` with your Railway domain (from DEPLOY-RAILWAY.md step 4),
> e.g. `https://clinic-crm-production.up.railway.app`.

---

Hi Truji,

The CRM is deployed and live at:

**`<YOUR-RAILWAY-URL>`**

Please register the webhook in Meta so the clinic can **receive** messages:

- **Callback URL:** `<YOUR-RAILWAY-URL>/webhook`
- **Verify token:** `weevolveit_dev_2026`

Subscribe these fields:
- **WhatsApp** → Configuration → Webhooks → subscribe **`messages`**
- **Messenger** → Webhooks → subscribe **`messages`**, **`messaging_postbacks`**
- **Instagram** → Webhooks → subscribe **`messages`**

Also, please add my test number **+92 305 559 8916** as a verified recipient
(WhatsApp → API Setup → "To") so I can test two-way messaging.

Meta will call the URL once to verify — the app answers that automatically. After
that, any message sent to the WhatsApp test number, to @weevolveit, or to the
WeEvolveit page will flow into the CRM, and replies from the CRM will go back to
the patient.

Thanks!
