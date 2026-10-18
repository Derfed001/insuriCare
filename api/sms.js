/**
 * Africa's Talking two-way SMS callback.
 * Dashboard -> SMS -> Callback URLs -> Incoming messages:  https://YOUR-SITE.vercel.app/api/sms?key=AT_WEBHOOK_SECRET
 */
const { normalizePhone, clean } = require('./_lib/util');
const store = require('./_lib/store');
const { converse } = require('./_lib/conversation');
const { sendSms, secretOk, parseBody } = require('./_lib/at');

const STOP = /^\s*(stop|unsubscribe|opt ?out|acha)\s*[.!]?\s*$/i;
const START = /^\s*(start|subscribe)\s*[.!]?\s*$/i;

/** Keep replies within three SMS segments, cutting at a sentence end where possible. */
function fitSms(text, max = 459) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, max - 1) + '.';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  if (!secretOk(req.query?.key)) return res.status(401).send('Unauthorized');

  const b = parseBody(req);
  const from = normalizePhone(b.from);
  const text = clean(b.text, 700);
  if (!from || !text) return res.status(200).send('ok');

  const msgId = b.id || `${from}:${b.date || ''}:${text.slice(0, 40)}`;
  if (!(await store.firstTime(`seen:sms:${msgId}`))) return res.status(200).send('ok');

  try {
    if (STOP.test(text)) {
      await store.set(`optout:sms:${from}`, 1);
      await sendSms(from, 'You have been unsubscribed from InsuriCare messages. Reply START to receive them again.');
      return res.status(200).send('ok');
    }
    if (START.test(text)) {
      await store.set(`optout:sms:${from}`, 0);
      await sendSms(from, 'Welcome back. Thank you for contacting InsuriCare. How may we help you today?');
      return res.status(200).send('ok');
    }
    if (await store.get(`optout:sms:${from}`)) return res.status(200).send('ok');

    await converse({ channel: 'sms', id: from, text, reply: t => sendSms(from, fitSms(t)) });
  } catch (e) {
    console.error('sms failed:', e.message);
  }
  return res.status(200).send('ok');
};
