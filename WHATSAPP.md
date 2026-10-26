# Turning on WhatsApp

ShiftReady sends by **WhatsApp first** and falls back to a **text** automatically:

- Welcome, shift offers, reminders and "moved off standby" messages go by WhatsApp, with **Accept / Decline buttons** on offers.
- If a temp hasn't got WhatsApp, Twilio tells ShiftReady within seconds and the same message is sent again as a text. ShiftReady remembers, so that temp gets texts from then on.
- Temps can also just reply **YES**, **NO** or **STANDBY** by text or WhatsApp.
- Bulk messages always go as texts (WhatsApp only allows free-form messages as replies).

Until the steps below are done, everything keeps going by text exactly as now.

---

## 1. Register your number as a WhatsApp sender (Twilio)

1. Twilio Console → **Messaging → Senders → WhatsApp senders → Create new sender**.
2. Choose your Twilio number **+44 7878 575984**.
3. It opens Meta's sign-up. Log in with the Facebook account that manages your business, and create or choose the **Meta Business** account for Staff Selection UK.
4. **Display name:** `Staff Selection UK`. **Category:** Professional services.
5. Meta verifies the number with a code. Twilio receives it automatically.
6. Once the sender is **Online**, open it and set **Webhook URL for incoming messages** to
   `https://shiftready-tan.vercel.app/api/sms/inbound` (method POST). Save.

Later, in Meta Business Settings, complete **Business verification** (company documents). Without it you can message about 250 new people a day; with it, the limit rises quickly.

## 2. Create the four message templates (Twilio)

Twilio Console → **Messaging → Content Template Builder → Create new**. For each one below:
name it exactly as shown, language **English (UK)**, then **Save and submit for WhatsApp approval** with category **Utility**.
Approval usually takes minutes to a day. Copy each template's id (starts `HX…`).

### `shiftready_welcome` (type: Quick reply)
Body:
```
Hi {{1}}, welcome to Staff Selection UK. You've been added to our ShiftReady list for temporary shifts near you. Would you like to receive shift offers from us here? You can stop at any time by replying STOP.
```
Buttons (title → id): `Yes, send me shifts` → `OPTIN` · `No thanks` → `OPTOUT`
Sample for {{1}}: `Dan`

### `shiftready_offer2` (type: Quick reply)
Body:
```
Hi {{1}}, new shift from Staff Selection UK:
Client: {{2}}
When: {{3}}
Where: {{5}}
Pay: £{{4}}/hr
Duties: {{6}}
You'll need: {{7}}
Full details: {{8}}
Tapping Accept confirms you have everything listed.
```
Buttons (title → id): `Accept` → `ACCEPT` · `Decline` → `DECLINE`
Samples: {{1}} `Dan` · {{2}} `Aire Valley Foods` · {{3}} `Wed 28 Oct 06:00-14:00` · {{4}} `12.71` · {{5}} `Unit 4, Euroway Estate, BD4 6SE` · {{6}} `Picking and packing` · {{7}} `safety boots, hi-vis vest` · {{8}} `https://shiftready-tan.vercel.app/s/example`

### `shiftready_reminder` (type: Text)
Body:
```
Hi {{1}}, reminder: you're booked at {{2}} tomorrow, {{3}}, at {{4}}. Please bring: {{5}}. See you there!
```
Samples: `Dan` · `Aire Valley Foods` · `06:00-14:00` · `Unit 4, Euroway Estate` · `safety boots, hi-vis vest`

### `shiftready_promoted` (type: Text)
Body:
```
Hi {{1}}, good news: a place has come up and you've been moved from standby onto {{2}}, {{3}}. Details: {{4}} See you there!
```
Samples: `Dan` · `Aire Valley Foods` · `Wed 28 Oct 06:00-14:00` · `https://shiftready-tan.vercel.app/s/example`

The `{{numbers}}` must stay exactly as shown: ShiftReady fills them in that order.
WhatsApp rejects a template that starts or ends with a `{{number}}`, so always keep some words after the last one.

## 3. Switch it on (Vercel)

Vercel → shiftready → **Settings → Environment Variables**, add:

| Key | Value |
|---|---|
| `TWILIO_WHATSAPP_FROM` | `+447878575984` |
| `WA_TEMPLATE_WELCOME` | the `HX…` id of shiftready_welcome |
| `WA_TEMPLATE_OFFER` | the `HX…` id of shiftready_offer |
| `WA_TEMPLATE_REMINDER` | the `HX…` id of shiftready_reminder |
| `WA_TEMPLATE_PROMOTED` | the `HX…` id of shiftready_promoted |

Then **Deployments → ⋯ → Redeploy**. You can add templates one at a time: any message type without a template id simply keeps going by text.

## Good to know

- **Consent:** WhatsApp requires that people agreed to be contacted. Make sure your KISREC registration asks temps to agree to job offers by text and WhatsApp.
- **Cost:** roughly 5p per WhatsApp template message, versus about 4p per text segment. Replies and confirmations within 24 hours of a temp messaging you are free on WhatsApp.
- **Which temps are on WhatsApp:** the Temps list shows a green **WhatsApp** label once a message has been delivered there.
