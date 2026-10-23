/**
 * Setup check: open https://YOUR-SITE.vercel.app/api/health in a browser.
 * It reports which settings are present and whether Gemini answers, and never shows any secret value.
 */
const store = require('./_lib/store');
const { modelList, callGemini, apiKey } = require('./_lib/gemini');

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
          headers: { 'x-goog-api-key': apiKey() }
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


  // Deeper check: ?test=1 really asks Gemini for an answer (plain, with web search, and streaming) and shows Google's reason if it fails.
  let probe;
  if (req.query && req.query.test && gemini.keySet) {
    if ((await store.incr(`rl:healthtest:${ip}:${Math.floor(Date.now() / 600000)}`, 600)) > 5) {
      probe = { error: 'Too many deep tests. Try again in a few minutes.' };
    } else {
      const hint = (status, detail) => {
        if (status === 429) return 'Quota or rate limit reached. Wait a minute and retry, check usage in AI Studio, or enable billing on the project.';
        if (status === 403) return 'Not allowed for this key or plan (often Google Search grounding on a free plan). The chat will still answer without web search.';
        if (status === 400) return 'Google rejected the request: ' + detail;
        if (status === 'error') return 'The request failed before reaching Google: ' + detail + ' If it mentions an invalid header value, the key has a space or line break: paste it again.';
        return '';
      };
      const limit = parseInt(process.env.HEALTH_PROBE_MS || '8000', 10);
      const run = async (label, { search = false, stream = false } = {}) => {
        const t0 = Date.now();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), limit);
        try {
          const r = await callGemini({
            stream, signal: ctl.signal,
            body: {
              contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
              generationConfig: { maxOutputTokens: 256 },
              ...(search ? { tools: [{ google_search: {} }] } : {})
            }
          });
          let raw = ''; try { raw = (await r.text()).replace(/\s+/g, ' '); } catch (_) { /* ignore */ }
          let detail = '';
          if (!r.ok) { try { detail = (JSON.parse(raw).error || {}).message || ''; } catch (_) { detail = raw; } }
          detail = String(detail).slice(0, 220);
          return { test: label, status: r.status, ok: r.ok, ms: Date.now() - t0, ...(r.ok ? {} : { detail, hint: hint(r.status, detail) }) };
        } catch (e) {
          if (e && e.name === 'AbortError') {
            return { test: label, status: 'timeout', ok: false, ms: Date.now() - t0, hint: `Gemini did not answer within ${Math.round(limit / 1000)} seconds. The model may be overloaded or slow. Try again in a minute; the chat falls back to answering without web search.` };
          }
          const detail = String(e && e.message).slice(0, 200);
          return { test: label, status: 'error', ok: false, ms: Date.now() - t0, detail, hint: hint('error', detail) };
        } finally {
          clearTimeout(timer);
        }
      };
      const tavilyKey = String(process.env.TAVILY_API_KEY || '').trim();
      const runTavily = async () => {
        const t0 = Date.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 10000);
        try {
          const r = await fetch('https://api.tavily.com/search', {
            method: 'POST', signal: ctl.signal,
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavilyKey}` },
            body: JSON.stringify({ query: 'Insurance Regulatory Authority Kenya', search_depth: 'basic', max_results: 1 })
          });
          const ms = Date.now() - t0;
          if (r.ok) return { test: 'web research (Tavily)', status: r.status, ok: true, ms };
          const h = r.status === 401 ? 'Tavily rejected the key. Copy it again from app.tavily.com into TAVILY_API_KEY (no spaces).'
            : (r.status === 429 || r.status === 432 || r.status === 433) ? 'Tavily says the free monthly credits or the rate limit are used up. They reset on the 1st of the month.' : '';
          return { test: 'web research (Tavily)', status: r.status, ok: false, ms, hint: h };
        } catch (e) {
          return { test: 'web research (Tavily)', status: e && e.name === 'AbortError' ? 'timeout' : 'error', ok: false, ms: Date.now() - t0, hint: 'Could not reach Tavily.' };
        } finally { clearTimeout(timer); }
      };
      probe = await Promise.all([run('answer'), run('answer with web search', { search: true }), run('streaming', { stream: true }), ...(tavilyKey ? [runTavily()] : [])]);
      if (probe.every(x => x.ok)) warnings.push('Deep test passed: Gemini answers normally, with web search and streaming.');
    }
  }

  // A common mistake: the API key or username typed into the variable NAME box instead of the value.
  if (Object.keys(process.env).some(k => /^atsk_/i.test(k) || /^AIza/.test(k))) {
    warnings.push('A Vercel variable has a name that looks like an API key. Delete it and add it again with the correct name (for example AT_API_KEY) and the key in the Value box. Also generate a new key, because names are not secret.');
  }
  if (!has('TAVILY_API_KEY')) warnings.push('Live web research is off. Add TAVILY_API_KEY (free at tavily.com, no card) so the assistant can search the web and insurers\' websites and cite its sources.');
  if (!has('AT_USERNAME') || !has('AT_API_KEY')) warnings.push('Africa\'s Talking is not set up (AT_USERNAME and AT_API_KEY). SMS replies, SMS alerts and the phone line need them.');
  if (!has('AT_WEBHOOK_SECRET')) warnings.push('AT_WEBHOOK_SECRET is not set. The SMS and phone callbacks reject every request without it.');
  if (!has('OWNER_PHONE')) warnings.push('OWNER_PHONE is not set, so alerts and the "speak to a team member" transfer cannot reach you.');

  res.status(200).send(JSON.stringify({
    ok: !!gemini.working,
    gemini,
    ...(probe ? { probe } : {}),
    africastalking: { usernameSet: has('AT_USERNAME'), apiKeySet: has('AT_API_KEY'), webhookSecretSet: has('AT_WEBHOOK_SECRET'), sandbox: has('AT_SANDBOX') },
    alerts: { ownerPhoneSet: has('OWNER_PHONE'), smsAlertsOn: process.env.ALERT_SMS !== '0' },
    research: { tavilyKeySet: has('TAVILY_API_KEY'), dailySearchCap: parseInt(process.env.SEARCH_DAILY_LIMIT || '30', 10) },
    memory: { upstashSet: has('UPSTASH_REDIS_REST_URL') && has('UPSTASH_REDIS_REST_TOKEN') },
    warnings
  }, null, 2));
};
