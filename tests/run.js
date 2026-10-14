// Offline tests: every external service (Gemini, WhatsApp, Telegram) is mocked.
const assert = require('assert');
const crypto = require('crypto');
const { EventEmitter } = require('events');

process.env.WA_TOKEN = 't'; process.env.WA_PHONE_NUMBER_ID = '123';
process.env.WA_VERIFY_TOKEN = 'verify-me'; process.env.WA_APP_SECRET = 'appsecret';
process.env.OWNER_WHATSAPP = '254700000001';
process.env.TELEGRAM_BOT_TOKEN = 'tg'; process.env.TELEGRAM_CHAT_ID = '42';
process.env.GEMINI_API_KEY = 'g';

const { normalizePhone, classify } = require('../api/_lib/util');
const store = require('../api/_lib/store');
const whatsapp = require('../api/whatsapp');
const callback = require('../api/callback');

let calls = [];
let geminiReply = { reply: 'Life cover pays your family if you pass away. Who would you like to cover?', escalate: false, urgency: 'normal', reason: '' };
let geminiDown = false;
global.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: String(url), body });
  const ok = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j), arrayBuffer: async () => Buffer.from('fakeaudio') });
  if (String(url).includes('generativelanguage')) {
    if (geminiDown) return { ok: false, status: 503, json: async () => ({}), text: async () => '' };
    return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify(geminiReply) }] } }] });
  }
  if (String(url).includes('graph.facebook.com') && /\/media-1$/.test(String(url))) return ok({ url: 'https://cdn.example/audio', mime_type: 'audio/ogg; codecs=opus' });
  if (String(url).startsWith('https://cdn.example')) return ok({});
  return ok({ messages: [{ id: 'x' }] });
};

function mkRes() {
  const r = { code: 200, body: undefined };
  r.status = c => { r.code = c; return r; };
  r.send = b => { r.body = b; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}
function mkWebhookReq(payload, { sign = true } = {}) {
  const raw = Buffer.from(JSON.stringify(payload));
  const req = new EventEmitter();
  req.method = 'POST';
  req.headers = sign ? { 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'appsecret').update(raw).digest('hex') } : {};
  process.nextTick(() => { req.emit('data', raw); req.emit('end'); });
  return req;
}
const incoming = (id, from, msg) => ({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name: 'Jane' } }], messages: [{ id, from, ...msg }] } }] }] });
const sentTo = (to) => calls.filter(c => c.url.includes('/123/messages') && c.body?.to === to);
const telegram = () => calls.filter(c => c.url.includes('api.telegram.org'));
const reset = () => { calls = []; store._reset(); geminiDown = false; };

(async () => {
  // --- util ---
  assert.strictEqual(normalizePhone('0115 129 088'), '254115129088');
  assert.strictEqual(normalizePhone('0712345678'), '254712345678');
  assert.strictEqual(normalizePhone('+254 712 345 678'), '254712345678');
  assert.strictEqual(normalizePhone('12345'), null);
  assert.strictEqual(classify('I want life insurance').urgency, null);
  assert.strictEqual(classify('I had an accident yesterday').urgency, 'urgent');
  assert.strictEqual(classify('nataka kufungua dai').urgency, 'urgent');
  assert.strictEqual(classify('please call me back').urgency, 'high');
  assert.strictEqual(classify('we have 45 staff and want medical').urgency, 'high');
  assert.strictEqual(classify('we have 5 staff').urgency, null);
  console.log('ok  util + escalation rules');

  // --- webhook verification ---
  let res = mkRes();
  await whatsapp({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc' } }, res);
  assert.strictEqual(res.code, 200); assert.strictEqual(res.body, 'abc');
  res = mkRes();
  await whatsapp({ method: 'GET', query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': 'abc' } }, res);
  assert.strictEqual(res.code, 403);
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m0', '254711111111', { type: 'text', text: { body: 'hi' } }), { sign: false }), res);
  assert.strictEqual(res.code, 401);
  console.log('ok  webhook verification + signature check');

  // --- normal question: AI answers, no alert ---
  reset();
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m1', '254711111111', { type: 'text', text: { body: 'What is life insurance?' } })), res);
  assert.strictEqual(res.code, 200);
  assert.strictEqual(sentTo('254711111111').length, 1);
  assert.strictEqual(telegram().length, 0);
  console.log('ok  routine question answered by AI, owner not disturbed');

  // --- retry of same message id is ignored ---
  const before = calls.length;
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m1', '254711111111', { type: 'text', text: { body: 'What is life insurance?' } })), res);
  assert.strictEqual(calls.length, before);
  console.log('ok  duplicate webhook delivery ignored');

  // --- claim: AI replies, owner alerted, AI pauses ---
  reset();
  geminiReply = { reply: "I'm sorry to hear that. A team member will help you with the claim.", escalate: true, urgency: 'urgent', reason: 'Car accident, wants to file claim' };
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m2', '254722222222', { type: 'text', text: { body: 'I had an accident, need to file a claim' } })), res);
  assert.strictEqual(telegram().length, 1);
  const alertText = telegram()[0].body.text;
  assert.ok(alertText.startsWith('[URGENT]'), alertText);
  assert.ok(alertText.includes('wa.me/254722222222'));
  assert.ok(await store.get('takeover:254722222222'));
  // client's next message: AI stays quiet (no Gemini call, no reply to client)
  const geminiBefore = calls.filter(c => c.url.includes('generativelanguage')).length;
  const clientMsgsBefore = sentTo('254722222222').length;
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m3', '254722222222', { type: 'text', text: { body: 'Hello?? anyone there' } })), res);
  assert.strictEqual(calls.filter(c => c.url.includes('generativelanguage')).length, geminiBefore);
  assert.strictEqual(sentTo('254722222222').length, clientMsgsBefore);
  assert.strictEqual(telegram().length, 2); // nudge
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m4', '254722222222', { type: 'text', text: { body: 'please respond' } })), res);
  assert.strictEqual(telegram().length, 2); // nudges are rate-limited
  console.log('ok  claim -> urgent alert, AI pauses, nudges rate-limited');

  // --- rules escalate even if the model says no ---
  reset();
  geminiReply = { reply: 'Sure, who is the cover for?', escalate: false, urgency: 'normal', reason: '' };
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m5', '254733333333', { type: 'text', text: { body: 'Can someone call me about group medical for 60 employees' } })), res);
  assert.strictEqual(telegram().length, 1);
  assert.ok(telegram()[0].body.text.startsWith('[ACTION NEEDED]'));
  console.log('ok  keyword rules escalate even when model does not');

  // --- voice note ---
  reset();
  geminiReply = { reply: 'Got your voice note. What car do you drive?', escalate: false, urgency: 'normal', reason: '' };
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m6', '254744444444', { type: 'audio', audio: { id: 'media-1' } })), res);
  const g = calls.find(c => c.url.includes('generativelanguage'));
  assert.ok(g.body.contents.at(-1).parts[0].inline_data.mime_type === 'audio/ogg');
  assert.strictEqual(sentTo('254744444444').length, 1);
  console.log('ok  voice note downloaded and passed to the assistant');

  // --- assistant down: safe fallback + alert ---
  reset(); geminiDown = true;
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m7', '254755555555', { type: 'text', text: { body: 'Hi I want car insurance' } })), res);
  assert.strictEqual(telegram().length, 1);
  assert.ok(sentTo('254755555555')[0].body.text.body.includes('team member'));
  console.log('ok  assistant outage -> polite fallback + owner alerted');

  // --- custom assistant service (your own agent) ---
  reset();
  process.env.ASSISTANT_URL = 'https://my-agent.example/chat';
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url) === process.env.ASSISTANT_URL) {
      calls.push({ url: String(url), body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ reply: 'Hello from my own agent', escalate: false, audio_url: 'https://my-agent.example/v.ogg' }) };
    }
    return realFetch(url, opts);
  };
  res = mkRes();
  await whatsapp(mkWebhookReq(incoming('m8', '254766666666', { type: 'text', text: { body: 'Hi' } })), res);
  const msgs = sentTo('254766666666');
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[1].body.type, 'audio');
  delete process.env.ASSISTANT_URL; global.fetch = realFetch;
  console.log('ok  custom assistant service: text + voice reply sent');

  // --- call-back form ---
  reset();
  const post = (body) => { const r = mkRes(); return callback({ method: 'POST', body }, r).then(() => r); };
  assert.strictEqual((await post({ name: '', phone: '0712345678' })).code, 400);
  assert.strictEqual((await post({ name: 'Jane', phone: '123' })).code, 400);
  assert.strictEqual((await post({ name: 'Bot', phone: '0712345678', website: 'spam.com' })).code, 200);
  assert.strictEqual(telegram().length, 0);
  res = await post({ name: 'Jane Wanjiku', phone: '0712 345 678', cover: 'Car Insurance', when: 'Evening (5pm-8pm)', notes: 'Toyota Axio 2018' });
  assert.strictEqual(res.code, 200); assert.strictEqual(res.body.alerted, true);
  const t = telegram()[0].body.text;
  assert.ok(t.includes('+254712345678') && t.includes('Evening') && t.includes('Car Insurance') && t.includes('Brief:'));
  assert.strictEqual((await post({ name: 'Jane Wanjiku', phone: '0712345678' })).code, 429);
  assert.strictEqual((await callback({ method: 'GET' }, mkRes()), 0), 0);
  console.log('ok  call-back form: validation, honeypot, alert with brief, rate limit');

  console.log('\nAll tests passed');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
