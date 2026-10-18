const { sendSms, atConfigured } = (() => { try { return require('./at'); } catch { return {}; } })();
const GRAPH = () => `https://graph.facebook.com/${process.env.WA_GRAPH_VERSION || 'v21.0'}`;

async function waPost(body) {
  const r = await fetch(`${GRAPH()}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body })
  });
  if (!r.ok) throw new Error(`whatsapp ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

const waConfigured = () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID);

function sendText(to, body) {
  return waPost({ to, type: 'text', text: { body: String(body).slice(0, 4000), preview_url: false } });
}
function sendAudio(to, link) {
  return waPost({ to, type: 'audio', audio: { link } });
}
/** Approved message template with a single {{1}} body variable (needed outside the 24-hour window). */
function sendTemplate(to, name, text) {
  return waPost({
    to, type: 'template',
    template: {
      name, language: { code: process.env.WA_TEMPLATE_LANG || 'en' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: String(text).replace(/\s*\n+\s*/g, ' | ').slice(0, 900) }] }]
    }
  });
}

async function downloadMedia(mediaId) {
  const meta = await fetch(`${GRAPH()}/${mediaId}`, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
  if (!meta.ok) throw new Error('media meta ' + meta.status);
  const { url, mime_type } = await meta.json();
  const file = await fetch(url, { headers: { Authorization: `Bearer ${process.env.WA_TOKEN}` } });
  if (!file.ok) throw new Error('media download ' + file.status);
  return { mime: mime_type, base64: Buffer.from(await file.arrayBuffer()).toString('base64') };
}

/** Short version of an alert for SMS (about two messages): keep the lines you act on, drop links. */
function compactForSms(urgency, title, lines) {
  const tag = urgency === 'urgent' ? 'URGENT' : urgency === 'high' ? 'ACTION NEEDED' : 'FYI';
  const keep = lines
    .filter(l => l && /^(Why|Heard|Summary|Message|Phone|Client|Best time|Cover):/.test(l))
    .map(l => l.replace(/\s+/g, ' '));
  const body = `[${tag}] ${title}. ${keep.join(' | ')}`;
  return body.length > 300 ? body.slice(0, 297) + '...' : body;
}

/** Alerts to your own phone by SMS. Needs OWNER_PHONE and Africa's Talking; turn off with ALERT_SMS=0. */
const smsAlertEnabled = () =>
  !!(atConfigured && atConfigured() && process.env.OWNER_PHONE && process.env.ALERT_SMS !== '0');

/**
 * Alert the agency owner. Sends to Telegram (reliable, no 24h rule) and/or WhatsApp.
 * WhatsApp alerts use an approved template if WA_TEMPLATE_ALERT is set, otherwise free text
 * (which WhatsApp only delivers if the owner messaged the business number in the last 24 hours).
 */
async function alertOwner({ urgency, title, lines }) {
  const tag = urgency === 'urgent' ? 'URGENT' : urgency === 'high' ? 'ACTION NEEDED' : 'FYI';
  const text = [`[${tag}] ${title}`, ...lines.filter(Boolean)].join('\n');
  const jobs = [];

  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    jobs.push(['telegram', fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, disable_web_page_preview: true })
    }).then(r => { if (!r.ok) throw new Error('telegram ' + r.status); })]);
  }
  if (waConfigured() && process.env.OWNER_WHATSAPP) {
    jobs.push(['whatsapp', process.env.WA_TEMPLATE_ALERT
      ? sendTemplate(process.env.OWNER_WHATSAPP, process.env.WA_TEMPLATE_ALERT, text)
      : sendText(process.env.OWNER_WHATSAPP, text)]);
  }
  if (smsAlertEnabled()) {
    const to = String(process.env.OWNER_PHONE).replace(/\D/g, '');
    jobs.push(['sms', sendSms(to, compactForSms(urgency, title, lines))]);
  }
  if (!jobs.length) console.warn('alertOwner: no alert channel configured:\n' + text);

  const results = await Promise.allSettled(jobs.map(j => j[1]));
  const sent = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') sent.push(jobs[i][0]);
    else console.error('alert failed via', jobs[i][0], r.reason && r.reason.message);
  });
  return sent;
}

module.exports = { sendText, sendAudio, sendTemplate, downloadMedia, alertOwner, waConfigured, compactForSms };
