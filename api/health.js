/**
 * Setup check: open https://YOUR-SITE.vercel.app/api/health in a browser.
 * It reports which settings are present and whether Gemini answers, and never shows any secret value.
 */
const store = require('./_lib/store');
const { modelList } = require('./_lib/gemini');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if ((await store.incr(`rl:health:${ip}:${Math.floor(Date.now() / 600000)}`, 600)) > 20) {
    return res.status(429).send(JSON.stringify({ ok: false, error: 'Too many checks. Try again in a few minutes.' }));
  }

  const has = n => !!(process.env[n] && String(process.env[n]).trim());
  const warnings = [];
  const gemini = { keySet: has('GEMINI_API_KEY'), working: null, tried: [] };

  if (!gemini.keySet) {
    warnings.push('GEMINI_API_KEY is not set. Add it in Vercel, then redeploy.');
  } else {
    for (const m of modelList()) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}`, {
          headers: { 'x-goog-api-key': String(process.env.GEMINI_API_KEY).trim() }
        });
        gemini.tried.push({ model: m, status: r.status });
        if (r.ok) { gemini.working = m; break; }
      } catch (e) {
        gemini.tried.push({ model: m, status: 'network error' });
      }
    }
    if (!gemini.working) {
      const last = gemini.tried[gemini.tried.length - 1];
      warnings.push(last && (last.status === 400 || last.status === 403)
        ? 'Gemini rejected the key. Check GEMINI_API_KEY (no spaces, created in AI Studio) and that the project is active.'
        : 'No Gemini model answered. The configured model may have been retired: delete GEMINI_MODEL and CHAT_MODEL in Vercel so the built-in list is used.');
    }
  }

  // A common mistake: the API key or username typed into the variable NAME box instead of the value.
  if (Object.keys(process.env).some(k => /^atsk_/i.test(k) || /^AIza/.test(k))) {
    warnings.push('A Vercel variable has a name that looks like an API key. Delete it and add it again with the correct name (for example AT_API_KEY) and the key in the Value box. Also generate a new key, because names are not secret.');
  }
  if (!has('AT_USERNAME') || !has('AT_API_KEY')) warnings.push('Africa\'s Talking is not set up (AT_USERNAME and AT_API_KEY). SMS replies, SMS alerts and the phone line need them.');
  if (!has('AT_WEBHOOK_SECRET')) warnings.push('AT_WEBHOOK_SECRET is not set. The SMS and phone callbacks reject every request without it.');
  if (!has('OWNER_PHONE')) warnings.push('OWNER_PHONE is not set, so alerts and the "speak to a team member" transfer cannot reach you.');

  res.status(200).send(JSON.stringify({
    ok: !!gemini.working,
    gemini,
    africastalking: { usernameSet: has('AT_USERNAME'), apiKeySet: has('AT_API_KEY'), webhookSecretSet: has('AT_WEBHOOK_SECRET'), sandbox: has('AT_SANDBOX') },
    alerts: { ownerPhoneSet: has('OWNER_PHONE'), smsAlertsOn: process.env.ALERT_SMS !== '0' },
    memory: { upstashSet: has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN') },
    warnings
  }, null, 2));
};
