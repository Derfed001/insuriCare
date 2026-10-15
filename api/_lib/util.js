const crypto = require('crypto');

/** Normalise a phone number to digits-only international format (254...). Returns null if invalid. */
function normalizePhone(input) {
  const d = String(input || '').replace(/[\s\-().]/g, '');
  let m;
  if ((m = d.match(/^\+?254([17]\d{8})$/))) return '254' + m[1];
  if ((m = d.match(/^0([17]\d{8})$/))) return '254' + m[1];
  if ((m = d.match(/^\+(\d{8,15})$/))) return m[1];
  return null;
}

/** Trim, strip control characters, cap length. */
function clean(v, max = 500) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function readRaw(req) {
  return new Promise((resolve, reject) => {
    if (req.rawBody) return resolve(Buffer.from(req.rawBody));
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Verify Meta's X-Hub-Signature-256 header against the raw request body. */
function verifySignature(rawBuf, header, secret) {
  if (!secret || !header) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(rawBuf).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(String(header));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Deterministic rules for "a human is needed". Runs on every client message,
 * independently of whatever the AI model decides.
 * urgency: 'urgent' | 'high' | null
 */
function classify(text) {
  const t = String(text || '').toLowerCase();
  const reasons = [];
  let urgency = null;
  const bump = (level, why) => {
    reasons.push(why);
    if (level === 'urgent') urgency = 'urgent';
    else if (!urgency) urgency = 'high';
  };

  if (/\b(accident|crash(ed)?|hospital|admitted|injur(y|ed)|ambulance|emergency|stolen|theft|burglar|fire|died|death|passed away|funeral|ajali|hospitali)\b/.test(t))
    bump('urgent', 'possible incident or emergency');
  if (/\b(claim|claims|reject(ed)?|denied|declined|fidia|dai)\b/.test(t))
    bump('urgent', 'claim-related');
  if (/\b(complain|complaint|angry|unhappy|disappointed|scam|fraud|cheat(ed)?|useless|refund|sue|lawyer|malalamiko)\b/.test(t))
    bump('urgent', 'complaint or dispute');
  if (/\b(speak to|talk to|call me|call back|phone me|human|agent|manager|someone|nipigie|nataka kuongea)\b/.test(t))
    bump('high', 'client asked for a person or a call');
  if (/(ready to (buy|pay|sign|proceed)|how (do|can) i pay|paybill|send (me )?(the )?(invoice|payment|account details)|want to (buy|purchase) (it|now)|let'?s proceed)/.test(t))
    bump('high', 'ready to buy or pay');
  const staff = t.match(/\b(\d{2,4})\s*(staff|employees|workers|members|people|students|drivers)\b/);
  if (staff && parseInt(staff[1], 10) >= 10) bump('high', `group enquiry (~${staff[1]} people)`);

  return { urgency, reasons };
}

const rank = { urgent: 2, high: 1, null: 0, undefined: 0 };
function maxUrgency(a, b) { return rank[a] >= rank[b] ? a : b; }

module.exports = { normalizePhone, clean, readRaw, verifySignature, classify, maxUrgency };
