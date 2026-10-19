# InsuriCare: AI assistant + call requests

The static site works on its own. This folder also contains Vercel functions (`/api`) that add:

| Feature | What happens |
|---|---|
| **Call us** buttons | Tap-to-call `tel:+254115129088` in the header, hero, claims section, contact list, and a floating button. Works with no setup. |
| **Request a call** form | Client leaves name, number, best time and topic. `/api/callback` alerts you (Telegram and/or WhatsApp) with an AI-written call brief. If the backend is not live, the form falls back to a pre-filled WhatsApp message. |
| **WhatsApp assistant** | `/api/whatsapp` answers client texts and voice notes instantly, collects quote details, and **alerts you only when a human is needed**. |
| **SMS assistant** | `/api/sms` (Africa's Talking two-way SMS) answers client texts with the same assistant, escalation and alerts. Replies are kept to about two SMS. `STOP` and `START` are honoured. |
| **Website chatbot** | The "Ask our assistant" button on the site (`/api/chat`). It works out what a visitor needs, explains the options in plain language as it types, and **searches the web (Google Search through Gemini)** for current insurer-specific facts, with source links. It needs only `GEMINI_API_KEY`. |
| **Phone line** | `/api/at-voice` (Africa's Talking Voice) answers calls: it says it is a virtual assistant, then a menu: **1** talk to the assistant, **2** claim or emergency (leave a message, urgent alert), **3** request a call back, **0** speak to a team member (rings your phone in office hours, otherwise takes a message). |

## When you get alerted

You are alerted (and the AI pauses for that client so you can take over) when a message is about:

- **URGENT:** accident, theft, hospital, death, a claim, a rejection, or a complaint (English and common Kiswahili words)
- **ACTION NEEDED:** the client asks for a person or a call, is ready to buy or pay, or is a group enquiry of about 10+ people
- Anything the AI itself flags as beyond its depth, or if the AI service is down

Routine questions ("what is life insurance?", "do you cover motorbikes?") are handled by the assistant and never disturb you. Every alert contains the client's number, why you were pinged, their message, and a `wa.me` link to reply.

After a hand-off the AI stays quiet for `TAKEOVER_HOURS` (default 6). If the client keeps writing you get one reminder every 30 minutes at most.

## Writing style
The assistant answers clients in your formal **client-mode** style (greeting by time of day, structured lines, no Sheng, no invented payment details). See `docs/CLIENT_STYLE_PROMPT.md` for the rules, example replies, your own message templates, and the phone-call script.

## Honest limits

- **Phone calls are turn-based, not real-time.** Africa's Talking records what the caller says, the assistant answers, then it listens again (up to 4 turns per call). Expect a pause of a few seconds each time. For real-time conversation you would need a streaming voice provider.
- **Your cloned voice on calls:** the line speaks with Africa's Talking's text-to-speech voice. To use your cloned voice, your own agent (`ASSISTANT_URL`) must return an `audio_url`, which the call then plays instead. Callers are still told it is a virtual assistant.
- **The assistant introduces itself as an AI.** It should never pose as you, especially if you plug in your cloned voice. Clients are entitled to know, and it protects your agency's reputation.
- **It never quotes exact premiums, confirms cover, or promises claim outcomes.** It gathers details; you decide.
- **WhatsApp's 24-hour rule:** the business number can only send free-form messages within 24 hours of a client's last message. Alerts to you and confirmations to website visitors outside that window need approved *message templates* (set `WA_TEMPLATE_ALERT`, `WA_TEMPLATE_CALLBACK`). Telegram alerts have no such limit, so set those up too.
- **Your number:** the WhatsApp Cloud API must be attached to a number. If +254 115 129 088 is in the normal WhatsApp or WhatsApp Business app, connecting it to the API changes how the app works (Meta's "coexistence" mode may keep both). Check Meta's current rules before migrating, or use a separate number for the assistant.
- Client chats pass through Meta, Google (Gemini) and Vercel/Upstash. Add a short privacy notice to your site and follow Kenya's Data Protection Act.

## Setup (about 45 minutes)

### 1. Alerts to your phone
**Simplest: SMS.** If Africa's Talking and `OWNER_PHONE` are set, every alert is also texted to your phone, short and without links. No extra setup. (In the Africa's Talking sandbox these appear in the simulator, not on your phone.) Turn off with `ALERT_SMS=0`.

**Optional: Telegram (free).** Skip this if SMS is enough.
1. In Telegram, message **@BotFather**, send `/newbot`, copy the **bot token**.
2. Message your new bot once, then open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id`.
3. Save as `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

### 2. The assistant brain (choose one)
- **Gemini (free tier):** create a key at aistudio.google.com, set `GEMINI_API_KEY`. Leave `GEMINI_MODEL` empty: the code picks a current Flash model itself and skips any that Google has retired (`gemini-2.5-flash` was shut down on 16 Oct 2026). To check your setup, open `https://YOUR-SITE.vercel.app/api/health`: it lists what is set, whether Gemini answers, and warns about common mistakes, without showing any secret.
- **Your own voice/text agent:** host it anywhere with a stable HTTPS endpoint (a Colab notebook link is not an endpoint) and set `ASSISTANT_URL`. If `GEMINI_API_KEY` is also set, Gemini answers whenever your agent is offline (+ optional `ASSISTANT_TOKEN`). The site sends:
  ```json
  { "channel": "whatsapp", "phone": "2547...", "name": "Jane", "text": "…",
    "first_message": true, "system_prompt": "facts + rules + client-mode style (see docs/CLIENT_STYLE_PROMPT.md)",
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

## Website chatbot (Makokha)
- **Name:** the assistant is called **Makokha** on the website, WhatsApp, SMS and calls, and always says it is an AI.
- **What it knows:** it reads your own website text (services, claims steps, checklists, FAQs, contacts, hours) and searches the web for current insurer facts. After you edit the site, redeploy and it knows the changes.
- **Setup:** nothing beyond `GEMINI_API_KEY` and a redeploy. Test it by opening the site and asking "Compare medical covers for a family of four".
- **What it will and won't do:** it explains covers, what to compare, and how insurers differ, using web search for current facts. It never states an exact premium, never confirms cover or decides claims, and tells visitors to get an exact quote from the team. Claims and complaints show buttons for WhatsApp, a call, or a call-back request.
- **Cost protection:** each visitor is limited to `CHAT_RATE_LIMIT` messages per 10 minutes, and the whole site to `CHAT_DAILY_LIMIT` per day. Raise or lower these in Vercel. Without Upstash the counters are per server instance and less strict, so set up Upstash.
- **Search grounding is billed by Google** after a free allowance and the allowance can change. Check your plan in AI Studio and keep an eye on usage in the first weeks.
- **Privacy:** chats are not stored by the site. Visitor messages go to Google (Gemini) to be answered, and the chat window warns visitors not to share ID numbers, passwords or PINs. Check Google's current terms for the free tier before real clients use it, and consider enabling billing. Add a short privacy notice to the site.
- **Accuracy:** web pages can be out of date or wrong. The bot shows its sources so visitors can check, and says when it is unsure, but review its answers yourself in the first weeks.

## Africa's Talking setup (SMS and calls)
1. Create an account at africastalking.com and an app. Note the **username** and generate an **API key**.
2. Choose a long random string as `AT_WEBHOOK_SECRET`.
3. **SMS:** get a shortcode or long number (and optionally an approved sender ID). In the dashboard open SMS → Callback URLs → *Incoming messages* and set  
   `https://YOUR-SITE.vercel.app/api/sms?key=YOUR_SECRET`
4. **Voice:** get a voice number. In the dashboard open Voice → your number → *Callback URL* and set  
   `https://YOUR-SITE.vercel.app/api/at-voice?key=YOUR_SECRET`
5. Add `AT_USERNAME`, `AT_API_KEY`, `AT_WEBHOOK_SECRET`, `OWNER_PHONE` (and the optional ones) in Vercel, then **Redeploy**.
6. Test: text the SMS number "What is life insurance?" and call the voice number. Press 1, speak, then press `#`. Press 2 and leave a message: you should get an URGENT alert on Telegram.

Notes
- SMS and call charges apply per message and per minute. Check Africa's Talking's Kenya rates before you publish the numbers.
- Africa's Talking can use a sandbox for SMS (`AT_SANDBOX=1`). Voice needs a live number.
- Keep your office hours in sync: `OFFICE_HOURS` in `index.html` (website) and `api/_lib/hours.js` (phone transfers), or set `OFFICE_HOURS_JSON`.
- If you record or store calls, tell callers and follow Kenya's Data Protection Act. Recordings sit on Africa's Talking's servers; the alert links to them.
- Africa's Talking's exact attribute names and voice options can change. If a call behaves oddly, compare the XML in `api/at-voice.js` with their current Voice XML docs.

## Taking a conversation over / giving it back
Reply to the client yourself using the link in the alert (`wa.me` for WhatsApp, `tel:` for SMS and calls). The AI resumes automatically after `TAKEOVER_HOURS`. To resume sooner, delete the key `takeover:<client number>` in the Upstash console.
