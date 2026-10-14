# InsuriCare: AI assistant + call requests

The static site works on its own. This folder also contains Vercel functions (`/api`) that add:

| Feature | What happens |
|---|---|
| **Call us** buttons | Tap-to-call `tel:+254115129088` in the header, hero, claims section, contact list, and a floating button. Works with no setup. |
| **Request a call** form | Client leaves name, number, best time and topic. `/api/callback` alerts you (Telegram and/or WhatsApp) with an AI-written call brief. If the backend is not live, the form falls back to a pre-filled WhatsApp message. |
| **WhatsApp assistant** | `/api/whatsapp` answers client texts and voice notes instantly, collects quote details, and **alerts you only when a human is needed**. |

## When you get alerted

You are alerted (and the AI pauses for that client so you can take over) when a message is about:

- **URGENT:** accident, theft, hospital, death, a claim, a rejection, or a complaint (English and common Kiswahili words)
- **ACTION NEEDED:** the client asks for a person or a call, is ready to buy or pay, or is a group enquiry of about 10+ people
- Anything the AI itself flags as beyond its depth, or if the AI service is down

Routine questions ("what is life insurance?", "do you cover motorbikes?") are handled by the assistant and never disturb you. Every alert contains the client's number, why you were pinged, their message, and a `wa.me` link to reply.

After a hand-off the AI stays quiet for `TAKEOVER_HOURS` (default 6). If the client keeps writing you get one reminder every 30 minutes at most.

## Honest limits

- **Live AI phone calls are not included.** The assistant handles WhatsApp text and voice notes. Answering real phone calls with a voice needs a telephony provider (e.g. Africa's Talking or Twilio Voice) wired to your voice service. That is a separate build.
- **The assistant introduces itself as an AI.** It should never pose as you, especially if you plug in your cloned voice. Clients are entitled to know, and it protects your agency's reputation.
- **It never quotes exact premiums, confirms cover, or promises claim outcomes.** It gathers details; you decide.
- **WhatsApp's 24-hour rule:** the business number can only send free-form messages within 24 hours of a client's last message. Alerts to you and confirmations to website visitors outside that window need approved *message templates* (set `WA_TEMPLATE_ALERT`, `WA_TEMPLATE_CALLBACK`). Telegram alerts have no such limit, so set those up too.
- **Your number:** the WhatsApp Cloud API must be attached to a number. If +254 115 129 088 is in the normal WhatsApp or WhatsApp Business app, connecting it to the API changes how the app works (Meta's "coexistence" mode may keep both). Check Meta's current rules before migrating, or use a separate number for the assistant.
- Client chats pass through Meta, Google (Gemini) and Vercel/Upstash. Add a short privacy notice to your site and follow Kenya's Data Protection Act.

## Setup (about 45 minutes)

### 1. Alerts to your phone (Telegram, free, do this first)
1. In Telegram, message **@BotFather**, send `/newbot`, copy the **bot token**.
2. Message your new bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
3. Save as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### 2. The assistant brain (choose one)
- **Gemini (free tier):** create a key at aistudio.google.com, set `GEMINI_API_KEY`. Set `GEMINI_MODEL` to a current model name from AI Studio (default `gemini-2.5-flash`).
- **Your own voice/text agent:** host it anywhere with an HTTPS endpoint and set `ASSISTANT_URL` (+ optional `ASSISTANT_TOKEN`). The site sends:
  ```json
  { "channel": "whatsapp", "phone": "2547...", "name": "Jane", "text": "…",
    "audio": { "mime": "audio/ogg", "base64": "…" },
    "history": [ { "role": "user|assistant", "text": "…" } ] }
  ```
  and expects:
  ```json
  { "reply": "text to send", "escalate": false, "urgency": "normal|high|urgent",
    "reason": "short note for you", "audio_url": "https://… (optional voice reply)" }
  ```
  `audio_url` must be a public HTTPS link to an audio file (ogg/opus or mp3). Keyword rules in `api/_lib/util.js` still escalate even if your agent says no.

### 3. Memory (free Upstash Redis, recommended)
Create a database at upstash.com and set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without it, chat history and the "AI paused" flag live in memory and can be lost between requests.

### 4. WhatsApp Cloud API
1. developers.facebook.com → Create app → Business → add **WhatsApp**.
2. Copy the **Phone number ID** and a **permanent access token** (System User token) → `WA_PHONE_NUMBER_ID`, `WA_TOKEN`.
3. App settings → Basic → copy **App Secret** → `WA_APP_SECRET`.
4. WhatsApp → Configuration → Webhook:
   - Callback URL: `https://YOUR-SITE.vercel.app/api/whatsapp`
   - Verify token: any long random string, also saved as `WA_VERIFY_TOKEN`
   - Subscribe to the **messages** field.
5. Set `OWNER_WHATSAPP` to your own number in digits only (e.g. `2547XXXXXXXX`).

### 5. Put the variables on Vercel
Project → Settings → Environment Variables: add everything from `.env.example`, then **Redeploy**.

### 6. Test
- Open the site, use **Request a call**: you should get a Telegram alert with a brief.
- WhatsApp the business number "What is life insurance?": the assistant answers, no alert.
- Send "I had an accident and need to file a claim": the assistant replies, you get an URGENT alert, and the AI goes quiet for that client.

Run the offline tests any time with `npm test` (no accounts needed).

## Taking a conversation over / giving it back
Reply to the client yourself using the `wa.me` link in the alert. The AI resumes automatically after `TAKEOVER_HOURS`. To resume sooner, delete the key `takeover:<client number>` in the Upstash console.
