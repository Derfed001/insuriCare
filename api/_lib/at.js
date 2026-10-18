/** Africa's Talking helpers: SMS sending and a few request utilities. */
const crypto = require('crypto');

const base = () => process.env.AT_SANDBOX ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
const atConfigured = () => !!(process.env.AT_USERNAME && process.env.AT_API_KEY);

/** Send an SMS. `to` is digits-only international format (2547...). */
async function sendSms(to, message) {
  const form = new URLSearchParams({ username: process.env.AT_USERNAME, to: '+' + to, message: String(message).slice(0, 459) });
  if (process.env.AT_SMS_FROM) form.set('from', process.env.AT_SMS_FROM);
  const r = await fetch(`${base()}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString()
  });
  if (!r.ok) throw new Error(`africastalking sms ${r.status} ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const rec = j?.SMSMessageData?.Recipients?.[0];
  if (rec && !/^(Success|Sent|Queued)/i.test(rec.status || '')) throw new Error('africastalking sms status: ' + rec.status);
  return j;
}

/** Callbacks carry a shared secret in the URL (?key=...). Constant-time compare. */
function secretOk(provided) {
  const secret = process.env.AT_WEBHOOK_SECRET;
  if (!secret || !provided) return false;
  const a = Buffer.from(String(provided)), b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Africa's Talking posts form-encoded bodies; Vercel usually parses them, but be defensive. */
function parseBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  if (typeof b === 'string') {
    try { return Object.fromEntries(new URLSearchParams(b)); } catch { return {}; }
  }
  return {};
}

module.exports = { sendSms, secretOk, parseBody, atConfigured };
