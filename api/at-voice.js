/**
 * Africa's Talking Voice callback (inbound calls).
 * Dashboard -> Voice -> your number -> Callback URL:  https://YOUR-SITE.vercel.app/api/at-voice?key=AT_WEBHOOK_SECRET
 *
 * Call flow
 *   greeting (says it is a virtual assistant) -> menu
 *   1  talk to the assistant: caller speaks, presses #, the assistant answers, up to MAX_TURNS times
 *   2  claim or emergency: caller leaves a message, you are alerted as URGENT
 *   3  request a call back: caller leaves a message, you are alerted
 *   0  speak to a team member: rings OWNER_PHONE in office hours, otherwise takes a message
 * Africa's Talking voice is turn-based (record, then answer), not real-time streaming, so expect a few seconds' pause.
 */
const { normalizePhone } = require('./_lib/util');
const store = require('./_lib/store');
const { askAssistant, voicemailBrief } = require('./_lib/assistant');
const { callGreeting } = require('./_lib/persona');
const { alertOwner } = require('./_lib/notify');
const { secretOk, parseBody } = require('./_lib/at');
const { isOpenEAT } = require('./_lib/hours');

const MAX_TURNS = 4;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Make text safe to read aloud: no emoji, markdown, links; bounded length. */
function speakable(t) {
  return String(t)
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`~<>]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ').trim().slice(0, 600);
}
const say = t => `<Say voice="${esc(process.env.AT_TTS_VOICE || 'woman')}">${esc(speakable(t))}</Say>`;
const play = url => `<Play url="${esc(url)}"/>`;
const xml = inner => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

function baseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `https://${host}`;
}
const cb = (req, step, extra = '') =>
  `${baseUrl(req)}/api/at-voice?step=${step}${extra}&key=${encodeURIComponent(process.env.AT_WEBHOOK_SECRET || '')}`;

const record = (req, step, extra = '', maxLength = 30) =>
  `<Record finishOnKey="#" maxLength="${maxLength}" timeout="6" trimSilence="true" playBeep="true" callbackUrl="${esc(cb(req, step, extra))}"/>`;

const GOODBYE = 'Thank you for calling InsuriCare. Goodbye.';
const SILENT = 'We did not hear anything. Please call again, or send us a WhatsApp message on +254 115 129 088. Goodbye.';

function menu(req) {
  return xml(
    `<GetDigits timeout="8" numDigits="1" callbackUrl="${esc(cb(req, 'menu'))}">` +
      say(`${callGreeting()} Press 1 to speak with me. Press 2 to report a claim or an emergency. Press 3 to request a call back. Press 0 to speak to a team member.`) +
    '</GetDigits>' +
    say('We did not receive your selection. Please call again, or send us a WhatsApp message. Goodbye.')
  );
}

async function fetchRecording(url) {
  if (!url) return null;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('recording ' + r.status);
    return { mime: (r.headers?.get?.('content-type') || 'audio/mpeg').split(';')[0], base64: Buffer.from(await r.arrayBuffer()).toString('base64') };
  } catch (e) {
    console.error('recording fetch failed:', e.message);
    return null;
  }
}

async function handler(req, res) {
  res.setHeader('Content-Type', 'application/xml');
  if (req.method !== 'POST') return res.status(405).send(xml(''));
  if (!secretOk(req.query?.key)) return res.status(401).send(xml(''));

  const b = parseBody(req);
  const step = req.query?.step || 'start';
  const caller = normalizePhone(b.callerNumber) || String(b.callerNumber || '').replace(/\D/g, '');
  const session = b.sessionId || caller;
  const who = caller ? `+${caller}` : 'unknown number';

  if (String(b.isActive) === '0') return res.status(200).send(xml('')); // call ended
  if (/outbound/i.test(b.direction || '')) return res.status(200).send(xml(''));

  try {
    // ---- entry: greeting + menu ----
    if (step === 'start') return res.status(200).send(menu(req));

    // ---- menu choice ----
    if (step === 'menu') {
      const d = String(b.dtmfDigits || '').trim();
      if (d === '1') {
        return res.status(200).send(xml(
          say('How can I help you? Please speak after the beep, and press the hash key when you are done.') + record(req, 'assist', '&turn=1') + say(SILENT)));
      }
      if (d === '2') {
        return res.status(200).send(xml(
          say('I am sorry to hear that. Please make sure you are safe. After the beep, tell us your name and what happened, then press the hash key. A team member will call you back.') +
          record(req, 'message', '&kind=claim', 60) + say(SILENT)));
      }
      if (d === '3') {
        return res.status(200).send(xml(
          say('After the beep, please say your name and what you need, and the best time to call you. Then press the hash key.') +
          record(req, 'message', '&kind=callback', 45) + say(SILENT)));
      }
      if (d === '0') {
        if (process.env.OWNER_PHONE && isOpenEAT()) {
          const callerId = process.env.AT_VOICE_NUMBER ? ` callerId="${esc(process.env.AT_VOICE_NUMBER)}"` : '';
          return res.status(200).send(xml(
            say('Please hold while I connect you to a team member.') +
            `<Dial phoneNumbers="${esc(process.env.OWNER_PHONE)}"${callerId} record="true" maxDuration="900"/>` +
            say('We could not reach a team member. After the beep, please leave your name and what you need, then press the hash key.') +
            record(req, 'message', '&kind=callback', 45) + say(SILENT)));
        }
        return res.status(200).send(xml(
          say('Our office is closed right now. After the beep, please leave your name and what you need, and a team member will call you back. Press the hash key when you are done.') +
          record(req, 'message', '&kind=callback', 45) + say(SILENT)));
      }
      return res.status(200).send(menu(req)); // unknown key: play the menu again
    }

    // ---- talk to the assistant ----
    if (step === 'assist') {
      const turn = parseInt(req.query?.turn || '1', 10);
      const audio = await fetchRecording(b.recordingUrl);
      if (!audio) return res.status(200).send(xml(say(SILENT)));

      const stateKey = `vs:${session}`;
      const history = (await store.get(stateKey)) || [];
      const result = await askAssistant({ channel: 'call', phone: caller, audio, history });
      await store.set(stateKey, [...history, { role: 'user', text: result.heard || '[caller audio]' }, { role: 'assistant', text: result.reply }].slice(-12), 3600);

      const speech = result.audio_url ? play(result.audio_url) : say(result.reply);

      if (result.escalate) {
        await alertOwner({
          urgency: result.urgency,
          title: `Caller ${who} needs you`,
          lines: [
            `Why: ${result.reasons.join('; ') || 'needs a human'}`,
            result.heard ? `Heard: ${result.heard}` : null,
            `Call back: tel:${who}`, `WhatsApp: https://wa.me/${caller}`
          ]
        });
        return res.status(200).send(xml(speech + say('A team member will call you back on this number shortly. ' + GOODBYE)));
      }
      if (turn >= MAX_TURNS) {
        return res.status(200).send(xml(speech + say('If you need more help, please call again or send us a WhatsApp message on +254 115 129 088. ' + GOODBYE)));
      }
      return res.status(200).send(xml(
        speech + say('Is there anything else? Speak after the beep, or hang up if that is all.') +
        record(req, 'assist', `&turn=${turn + 1}`) + say(GOODBYE)));
    }

    // ---- leave a message (claim / call back / after hours) ----
    if (step === 'message') {
      const kind = req.query?.kind === 'claim' ? 'claim' : 'callback';
      const audio = await fetchRecording(b.recordingUrl);
      const brief = await voicemailBrief(audio);
      await alertOwner({
        urgency: kind === 'claim' ? 'urgent' : 'high',
        title: kind === 'claim' ? `Claim or emergency call from ${who}` : `Call-back request from ${who}`,
        lines: [
          brief ? `Summary: ${brief}` : null,
          b.recordingUrl ? `Recording: ${b.recordingUrl}` : 'No recording captured',
          `Call back: tel:${who}`, `WhatsApp: https://wa.me/${caller}`
        ]
      });
      return res.status(200).send(xml(say('Thank you. Your message has been received, and a team member will call you back shortly. ' + GOODBYE)));
    }
  } catch (e) {
    console.error('voice failed:', e.message);
    return res.status(200).send(xml(say('Sorry, we are having a technical problem. Please call again in a moment, or send us a WhatsApp message on +254 115 129 088. Goodbye.')));
  }
  return res.status(200).send(menu(req));
}

module.exports = handler;
