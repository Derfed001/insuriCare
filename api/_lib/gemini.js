/**
 * One place that calls Gemini. If a model has been retired (HTTP 404), it moves on to the next one,
 * so a Google model shutdown cannot silently take the assistant offline again.
 */
const DEFAULT_MODELS = ['gemini-flash-latest', 'gemini-3.6-flash', 'gemini-3.5-flash'];
const dead = new Set();

/** Values pasted into Vercel often carry an invisible trailing space or line break, which makes the request fail. */
const clean = v => String(v || '').trim();
const apiKey = () => clean(process.env.GEMINI_API_KEY);

function modelList() {
  const all = [...new Set([clean(process.env.CHAT_MODEL), clean(process.env.GEMINI_MODEL), ...DEFAULT_MODELS].filter(Boolean))];
  const live = all.filter(m => !dead.has(m));
  if (live.length) return live;
  dead.clear();
  return all;
}

/** POST a generateContent (or streaming) request. Returns the first response that is not a 404. */
async function callGemini({ body, stream = false, signal }) {
  let last = null;
  for (const m of modelList()) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const r = await fetch(url, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey() },
      body: JSON.stringify(body)
    });
    if (r.status !== 404) return r;
    dead.add(m);
    console.error(`gemini model "${m}" not found (retired or misspelled). Trying the next one.`);
    last = r;
  }
  return last;
}

/** Log why a Gemini call failed without leaking the key. */
async function logFailure(r, where) {
  let detail = '';
  try { detail = (await r.text()).replace(/\s+/g, ' ').slice(0, 300); } catch (_) { /* ignore */ }
  console.error(`${where}: gemini ${r.status} ${detail}`);
}

function _reset() { dead.clear(); }

module.exports = { callGemini, logFailure, modelList, apiKey, _reset };
