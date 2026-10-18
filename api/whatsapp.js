/**
 * WhatsApp Cloud API webhook.
 *   GET  -> Meta's one-time verification handshake
 *   POST -> incoming client messages (text and voice notes)
 */
const { readRaw, verifySignature } = require('./_lib/util');
const store = require('./_lib/store');
const { converse } = require('./_lib/conversation');
const { sendText, sendAudio, downloadMedia } = require('./_lib/notify');

const UNSUPPORTED_TEXT = 'Kindly send your request as a text message or a voice note so that we can assist you. Thank you.';

async function handleMessage(msg, contact) {
  const from = msg.from;
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
  await converse({
    channel: 'whatsapp', id: from, name: contact?.profile?.name || '', text, audio,
    reply: t => sendText(from, t),
    replyAudio: u => sendAudio(from, u)
  });
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
