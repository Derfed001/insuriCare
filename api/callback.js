/**
 * Website "Request a call back" form -> alerts the owner with an AI-written call brief.
 * Optionally sends the client a WhatsApp confirmation (needs an approved template, see AUTOMATION.md).
 */
const { normalizePhone, clean } = require('./_lib/util');
const store = require('./_lib/store');
const { callBrief } = require('./_lib/assistant');
const { alertOwner, sendTemplate, waConfigured } = require('./_lib/notify');

const WHEN = ['As soon as possible', 'Morning (8am-12pm)', 'Afternoon (12pm-5pm)', 'Evening (5pm-8pm)'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  if (b.website) return res.status(200).json({ ok: true }); // honeypot: bots fill this in

  const name = clean(b.name, 80);
  const phone = normalizePhone(b.phone);
  const cover = clean(b.cover, 80) || 'General enquiry';
  const when = WHEN.includes(b.when) ? b.when : WHEN[0];
  const notes = clean(b.notes, 400);

  if (name.length < 2) return res.status(400).json({ ok: false, error: 'Please enter your name.' });
  if (!phone) return res.status(400).json({ ok: false, error: 'Please enter a valid phone number, e.g. 0712 345 678.' });

  // Light rate limit: one request per number every 2 minutes.
  if (!(await store.firstTime(`cb:${phone}`, 120))) {
    return res.status(429).json({ ok: false, error: 'We already have your request. We will call you shortly.' });
  }

  const brief = await callBrief({ name, cover, notes });
  const sent = await alertOwner({
    urgency: 'high',
    title: `Call-back request from ${name}`,
    lines: [`Phone: +${phone}`, `Best time: ${when}`, `Cover: ${cover}`, brief, `Call: tel:+${phone}`, `WhatsApp: https://wa.me/${phone}`]
  });

  if (waConfigured() && process.env.WA_TEMPLATE_CALLBACK) {
    try { await sendTemplate(phone, process.env.WA_TEMPLATE_CALLBACK, `${name}, ${when.toLowerCase()}`); }
    catch (e) { console.error('client confirmation failed:', e.message); }
  }

  return res.status(200).json({ ok: true, alerted: sent.length > 0 });
};
