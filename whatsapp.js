/**
 * WhatsApp Cloud API webhook.
 *   GET  -> Meta's one-time verification handshake
 *   POST -> incoming client messages (text and voice notes)
 * The assistant answers instantly; anything that needs a human alerts the owner and pauses the AI
 * for that client so you can take over without the bot talking over you.
 */
const { readRaw, verifySignature } = require('./_lib/util');
const store = require('./_lib/store');
const { askAssistant } = require('./_lib/assistant');
const { sendText, sendAudio, downloadMedia, alertOwner } = require('./_lib/notify');

const HANDOFF_TEXT = "Thanks, I've alerted a team member at InsuriCare and they will follow up with you shortly. " +
  "If it's urgent, please call +254 115 129 088.";
const UNSUPPORTED_TEXT = "I can read text messages and voice notes. Could you send your request in one of those?";
const TAKEOVER_SEC = Math.round(parseFloat(process.env.TAKEOVER_HOURS || '6') * 3600);

async function handleMessage(msg, contact) {
  const from = msg.from;
  const name = contact?.profile?.name || '';

  if (!(await store.firstTime(`seen:${msg.id}`))) return; // Meta retry

  if (msg.type !== 'text' && msg.type !== 'audio') {
    await sendText(from, UNSUPPORTED_TEXT);
    return;
  }

  const text = msg.type === 'text' ? msg.text?.body || '' : '';
  let audio = null;
  if (msg.type === 'audio') {
    try { audio = await downloadMedia(msg.audio.id); }
    catch (e) { console.error('voice note download failed:', e.message); }
  }

  // Human has taken over this conversation: stay quiet, but nudge the owner if the client keeps writing.
  const takeover = await store.get(`takeover:${from}`);
  if (takeover) {
    const last = await store.get(`nudge:${from}`);
    if (!last) {
      await store.set(`nudge:${from}`, 1, 1800);
      await alertOwner({
        urgency: takeover.urgency, title: `${name || from} sent a new message`,
        lines: [`Chat: https://wa.me/${from}`, text ? `Message: ${text.slice(0, 300)}` : 'Message: voice note']
      });
    }
    return;
  }

  const history = (await store.get(`hist:${from}`)) || [];
  const result = await askAssistant({ channel: 'whatsapp', phone: from, name, text, audio, history });

  await sendText(from, result.reply);
  if (result.audio_url) {
    try { await sendAudio(from, result.audio_url); } catch (e) { console.error('audio send failed:', e.message); }
  }

  const userTurn = text || '[voice note]';
  const next = [...history, { role: 'user', text: userTurn }, { role: 'assistant', text: result.reply }].slice(-14);
  await store.set(`hist:${from}`, next, 7 * 86400);

  if (result.escalate) {
    await alertOwner({
      urgency: result.urgency,
      title: `${name || 'Client'} needs you on WhatsApp`,
      lines: [
        `Client: ${name ? name + ' ' : ''}+${from}`,
        `Why: ${result.reasons.join('; ') || 'needs a human'}`,
        text ? `Message: ${text.slice(0, 300)}` : 'Message: voice note',
        `Reply: https://wa.me/${from}`
      ]
    });
    await store.set(`takeover:${from}`, { urgency: result.urgency, at: Date.now() }, TAKEOVER_SEC);
    if (result.reply !== HANDOFF_TEXT && !/team member|alerted/i.test(result.reply)) {
      await sendText(from, HANDOFF_TEXT);
    }
  }
}

async function handler(req, res) {
  if (req.method === 'GET') {
    const q = req.query || {};
    if (q['hub.mode'] === 'subscribe' && process.env.WA_VERIFY_TOKEN && q['hub.verify_token'] === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(q['hub.challenge']);
    }
    return res.status(403).send('Forbidden');
  }
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const raw = await readRaw(req);
  if (!verifySignature(raw, req.headers['x-hub-signature-256'], process.env.WA_APP_SECRET)) {
    return res.status(401).send('Bad signature');
  }

  let body;
  try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).send('Bad JSON'); }

  try {
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        for (const msg of v.messages || []) {
          try { await handleMessage(msg, (v.contacts || []).find(c => c.wa_id === msg.from)); }
          catch (e) { console.error('message failed:', e.message); }
        }
      }
    }
  } catch (e) {
    console.error('webhook error:', e.message);
  }
  return res.status(200).send('ok'); // always 200 so Meta does not retry-storm
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
