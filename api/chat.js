/**
 * Website chatbot: streams answers (Server-Sent Events) from Gemini. For insurer-specific and current questions it
 * researches first (Tavily web search over insurers' sites and the wider web, see _lib/research.js) and must cite what it found.
 * Without a Tavily key it falls back to Gemini's own Google Search grounding. Stateless: the browser sends the history.
 *
 * Events (one JSON object per `data:` line):
 *   {t:'status', v:'...'}   progress note while researching
 *   {t:'queries', v:[...]}  web searches that were run
 *   {t:'text', v:'...'}     next piece of the answer
 *   {t:'sources', v:[{n,title,uri,host,kind}]}  kind: insurer | regulator | other
 *   {t:'escalate', urgency, reasons}  the message looks like it needs a person
 *   {t:'error', v:'...'} / {t:'done'}
 */
const { clean, classify } = require('./_lib/util');
const store = require('./_lib/store');
const { buildChatPrompt } = require('./_lib/chatPrompt');
const { callGemini, logFailure } = require('./_lib/gemini');
const research = require('./_lib/research');

const MAX_MESSAGES = 12;
const MAX_CHARS = 1200;
const TEN_MIN = 600;

const send = (res, o) => res.write(`data: ${JSON.stringify(o)}\n\n`);

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return null;
  let msgs = raw
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
    .map(m => ({ role: m.role, text: clean(m.text, MAX_CHARS) }))
    .filter(m => m.text);
  msgs = msgs.slice(-MAX_MESSAGES);
  while (msgs.length && msgs[0].role !== 'user') msgs.shift(); // Gemini needs the first turn to be the user's
  if (!msgs.length || msgs[msgs.length - 1].role !== 'user') return null;
  return msgs;
}

// When Google refuses web search (quota, plan or unsupported), stop asking for a while: it only slows every answer down.
let searchOffUntil = 0;

function ask(msgs, { tools, mode, context }, signal) {
  const contents = msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] }));
  if (context) contents[contents.length - 1].parts[0].text += '\n\n' + context; // the fetched pages ride with the question, never in stored history
  const body = {
    systemInstruction: { parts: [{ text: buildChatPrompt(Date.now(), { mode: tools ? 'grounding' : mode }) }] },
    contents,
    // Newer Gemini models "think" before answering and thinking counts toward this limit, so keep it generous.
    generationConfig: { maxOutputTokens: 4096 }
  };
  if (tools) body.tools = [{ google_search: {} }];
  return callGemini({ body, stream: true, signal });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.GEMINI_API_KEY) return res.status(503).json({ error: 'The assistant is not available right now.' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch { b = null; } }
  const msgs = sanitizeMessages(b && b.messages);
  if (!msgs) return res.status(400).json({ error: 'Please type a message.' });

  // Abuse and cost protection: per-visitor and daily limits.
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
  const perIp = parseInt(process.env.CHAT_RATE_LIMIT || '20', 10);
  const perDay = parseInt(process.env.CHAT_DAILY_LIMIT || '800', 10);
  const bucket = Math.floor(Date.now() / (TEN_MIN * 1000));
  const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  if ((await store.incr(`rl:chat:${ip}:${bucket}`, TEN_MIN)) > perIp) {
    return res.status(429).json({ error: 'You are sending messages quickly. Please wait a few minutes, or contact us on WhatsApp.' });
  }
  if ((await store.incr(`rl:chat:day:${day}`, 90000)) > perDay) {
    return res.status(429).json({ error: 'Our assistant has reached its limit for today. Please contact us on WhatsApp or call +254 115 129 088.' });
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);

  const lastUser = msgs[msgs.length - 1].text;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 55000);
  const queries = new Set();
  const sources = new Map();
  let produced = false;

  // One attempt, abandoned if Gemini has not started answering in time (CHAT_FIRST_BYTE_MS overrides).
  const override = parseInt(process.env.CHAT_FIRST_BYTE_MS || '0', 10);
  const attempt = async (opts) => {
    const a = new AbortController();
    const link = () => a.abort();
    ctl.signal.addEventListener('abort', link);
    const t = setTimeout(() => a.abort(), override || (opts.tools ? 12000 : 20000)); // Google's own search gets 12 s, then the plain answer gets 20 s
    try {
      return await ask(msgs, opts, a.signal);
    } catch (e) {
      return { ok: false, status: e && e.name === 'AbortError' ? 'timeout' : 'error', error: e };
    } finally {
      clearTimeout(t);                       // the answer has started (or failed): the body can stream on
    }
  };
  const why = async (r, where) => (r.error ? console.error(`${where}: ${r.status} ${r.error.message}`) : logFailure(r, where));

  try {
    // ---- 1) research: plan the search, search the web and insurers' sites, pick the best passages ----
    let mode = 'grounding', context = '', found = null;
    if (research.configured()) {
      try {
        found = await Promise.race([
          research.research(msgs, { onStatus: v => send(res, { t: 'status', v }) }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('research timeout')), parseInt(process.env.RESEARCH_TIMEOUT_MS || '16000', 10)))
        ]);
      } catch (e) {
        console.error('research failed:', e.message);
        found = { available: true, ran: true, failed: true };
      }
      if (found.ran && found.sources && found.sources.length) { mode = 'sources'; context = found.context; }
      else if (found.ran && !found.failed) mode = 'empty';
      else if (found.available && found.ran === false) mode = 'skipped';
      if (found.queries && found.queries.length && found.ran && !found.failed) send(res, { t: 'queries', v: found.queries });
    }

    // ---- 2) answer ----
    let r;
    if (mode === 'grounding') {
      // no Tavily key, or research failed: try Gemini's own Google Search, then answer without any search
      const searchOff = Date.now() < searchOffUntil;
      r = searchOff ? { ok: false, skip: true } : await attempt({ tools: true });
      if (!r.ok) {
        if (!r.skip) {
          await why(r, 'chat (with search)');
          if ([400, 403, 429].includes(r.status)) searchOffUntil = Date.now() + 10 * 60 * 1000;
        }
        r = await attempt({ tools: false, mode: 'none' });
      }
    } else {
      r = await attempt({ tools: false, mode, context });
      if (!r.ok && context) { await why(r, 'chat (with sources)'); r = await attempt({ tools: false, mode, context: context.slice(0, 6000) + '\n</web_sources>' }); }
    }
    if (!r.ok) { await why(r, 'chat'); throw new Error('gemini ' + r.status); }

    const reader = r.body.getReader();
    const dec = new TextDecoder();

    // One server-sent event from Google: pull out the answer text, the searches it ran and its sources.
    const onEvent = (raw) => {
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let j; try { j = JSON.parse(line.slice(5).trim()); } catch { continue; }
        const cand = j.candidates && j.candidates[0];
        if (!cand) continue;
        const gm = cand.groundingMetadata;
        if (gm) {
          const fresh = (gm.webSearchQueries || []).filter(q => !queries.has(q));
          fresh.forEach(q => queries.add(q));
          if (fresh.length) send(res, { t: 'queries', v: fresh.slice(0, 3) });
          (gm.groundingChunks || []).forEach(g => {
            if (g.web && g.web.uri && /^https?:\/\//.test(g.web.uri)) sources.set(g.web.title || g.web.uri, g.web.uri);
          });
        }
        // Skip "thought" parts: they are the model's reasoning, not the answer.
        const text = (cand.content && cand.content.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        if (text) { produced = true; send(res, { t: 'text', v: text }); }
      }
    };

    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Google streams with Windows-style line endings (\r\n\r\n); normalise before looking for blank lines.
      buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      const parts = buf.split('\n\n');
      buf = parts.pop();
      parts.forEach(onEvent);
    }
    buf = (buf + dec.decode()).replace(/\r\n/g, '\n');
    if (buf.trim()) onEvent(buf); // the last event may arrive without a trailing blank line
    if (!produced) send(res, { t: 'text', v: 'I could not answer that. Please contact our team on WhatsApp or call +254 115 129 088 and we will help you.' });
    if (found && found.sources && found.sources.length && mode === 'sources') send(res, { t: 'sources', v: found.sources });
    else if (sources.size) send(res, { t: 'sources', v: [...sources].slice(0, 6).map(([title, uri], i) => ({ n: i + 1, title, uri, host: (() => { try { return new URL(uri).hostname; } catch { return ''; } })(), kind: 'other' })) });
    const rules = classify(lastUser);
    if (rules.urgency) send(res, { t: 'escalate', urgency: rules.urgency, reasons: rules.reasons });
    send(res, { t: 'done' });
  } catch (e) {
    console.error('chat error:', e.message);
    send(res, { t: 'error', v: 'Sorry, I could not get an answer just now. Please try again, or contact us on WhatsApp or +254 115 129 088.' });
    send(res, { t: 'done' });
  } finally {
    clearTimeout(timer);
    res.end();
  }
};
module.exports._resetSearch = () => { searchOffUntil = 0; };
