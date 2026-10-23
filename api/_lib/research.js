/**
 * Live research for the website chatbot.
 *   1. plan:   a fast Gemini call decides whether a web search is needed and writes precise queries
 *   2. search: Tavily (free plan, no card) searches the web, including insurers' own websites, and returns page text
 *   3. select: pick the most relevant passages from the best pages, official insurer and regulator sites first
 *   4. answer: chat.js gives the numbered passages to Gemini, which must cite them
 * Results are cached, and a daily cap protects the free plan.
 */
const crypto = require('crypto');
const store = require('./store');
const { callGemini } = require('./gemini');

const tavilyKey = () => String(process.env.TAVILY_API_KEY || '').trim();
const configured = () => !!tavilyKey();

// Words in a site's hostname that mark it as an insurer's own site, or an official body.
const INSURER_TOKENS = ['britam', 'cic.co.ke', 'cicinsurance', 'cicgroup', 'jubilee', 'monarch', 'definite', 'apainsurance', 'heritage.co.ke', 'heritageinsurance', 'icealion', 'oldmutual', 'sanlam', 'allianz', 'madison', 'pioneerassurance', 'kenyare', 'uapinsurance', 'geminsurance', 'trinity', 'directline', 'takaful', 'resolution'];
const REGULATOR_TOKENS = ['ira.go.ke', 'nssf.or.ke', 'sha.go.ke', 'kra.go.ke', 'treasury.go.ke', 'kenyalaw.org', 'rba.go.ke', 'cma.or.ke', 'odpc.go.ke', 'labour.go.ke'];

const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function kindOf(host) {
  if (REGULATOR_TOKENS.some(t => host.endsWith(t) || host.includes(t))) return 'regulator';
  if (INSURER_TOKENS.some(t => host.includes(t))) return 'insurer';
  return 'other';
}

const STOP = new Set('the and for with what which how does can you your are that this from have has was were will about into than then them they their there who whom whose when where why not but any all more most some such only own same too very just also its our out per via get got let may might shall should would could into onto over under again further once here both each few other nor off'.split(' '));

const PLANNER_PROMPT = `You plan web searches for an insurance assistant that serves Kenyan families and businesses (InsuriCare Insurance Agency, Nairobi).
Decide whether answering the visitor's last message needs current information from the web: an insurer's products, benefits, eligibility, premiums, rules, claims processes, comparisons between insurers, regulations (IRA, SHA, NSSF, KRA, WIBA), or recent news.
Do NOT search for greetings, thanks, questions about InsuriCare itself (its services, hours, contacts, how to file a claim with us, checklists, FAQs), or general ideas that never change (what "excess" means).
If a search is needed, write 1 or 2 short, specific queries in English that include the insurer or product names and "Kenya". If one or more insurers are named, also give the domains of their official Kenyan websites (for example "britam.com") in "official_domains" (at most 3, only if you are confident of the domain).
Return ONLY JSON: {"search": boolean, "queries": string[], "official_domains": string[]}`;

const NEEDS_SEARCH = /\b(britam|cic|jubilee|monarch|definite|apa|heritage|icea|lion|old mutual|sanlam|allianz|nssf|sha|nhif|ira|kra|premium|premiums|price|prices|cost|costs|benefit|benefits|compare|comparison|best|cheapest|rate|rates|how much|limit|limits|requirements|eligib\w*|waiting period|regulat\w*|law|act|policy terms|exclusions?)\b/i;

function heuristicPlan(text) {
  return NEEDS_SEARCH.test(text)
    ? { search: true, queries: [`${String(text).slice(0, 140)} Kenya insurance`], official_domains: [] }
    : { search: false, queries: [], official_domains: [] };
}

async function planSearch(msgs, nowMs = Date.now()) {
  const last = msgs[msgs.length - 1].text;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await callGemini({
      signal: ctl.signal,
      body: {
        systemInstruction: { parts: [{ text: PLANNER_PROMPT + `\nToday is ${new Date(nowMs + 3 * 3600 * 1000).toISOString().slice(0, 10)}.` }] },
        contents: msgs.slice(-4).map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })),
        generationConfig: { maxOutputTokens: 500, responseMimeType: 'application/json' }
      }
    });
    if (!r.ok) throw new Error('planner ' + r.status);
    const data = await r.json();
    const out = (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')
      .replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const j = JSON.parse(out);
    const queries = (Array.isArray(j.queries) ? j.queries : []).map(q => String(q).replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 2);
    const domains = (Array.isArray(j.official_domains) ? j.official_domains : []).map(d => String(d).toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
      .filter(d => /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(d)).slice(0, 3);
    if (!j.search || !queries.length) return { search: false, queries: [], official_domains: [] };
    return { search: true, queries, official_domains: domains };
  } catch (e) {
    console.error('search planner failed, using keyword rules:', e.message);
    return heuristicPlan(last);
  } finally {
    clearTimeout(timer);
  }
}

/** Keep the passages of a page that best match the question (instead of menus and cookie banners). */
function excerpt(raw, query, max = 2200) {
  const text = String(raw || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  const paras = text.split(/\n{2,}|\n(?=[#*\u2022-])/).map(p => p.trim()).filter(p => p.length > 40);
  if (!paras.length) return text.trim().slice(0, max);
  const words = [...new Set(String(query).toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w)))];
  const scored = paras.map((p, i) => ({ p, i, s: words.reduce((n, w) => n + (p.toLowerCase().includes(w) ? 1 : 0), 0) }));
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  const picked = []; let used = 0;
  for (const x of scored) {
    if (x.s === 0 && picked.length) break;
    const piece = x.p.slice(0, 900);
    if (used + piece.length > max) { if (!picked.length) { picked.push({ i: x.i, p: piece.slice(0, max) }); } break; }
    picked.push({ i: x.i, p: piece }); used += piece.length;
  }
  return picked.sort((a, b) => a.i - b.i).map(x => x.p).join('\n');
}

const safeText = s => String(s || '').replace(/[<>]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function tavilyOnce(query, domains, signal) {
  const key = `rs:${crypto.createHash('sha1').update(query + '|' + domains.join(',')).digest('hex')}`;
  const cached = await store.get(key);
  if (cached) return cached;

  const limit = parseInt(process.env.SEARCH_DAILY_LIMIT || '30', 10);
  const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  if ((await store.incr(`rl:search:day:${day}`, 90000)) > limit) { const e = new Error('daily search limit reached'); e.code = 'CAP'; throw e; }

  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tavilyKey()}` },
    body: JSON.stringify({ query, search_depth: 'basic', max_results: 6, include_answer: false, include_raw_content: true, ...(domains.length ? { include_domains: domains } : {}) })
  });
  if (!r.ok) { const e = new Error('tavily ' + r.status); e.status = r.status; throw e; }
  const j = await r.json();
  const results = (j.results || []).filter(x => x && /^https?:\/\//.test(x.url || '')).map(x => ({
    title: String(x.title || hostOf(x.url)).slice(0, 140), url: x.url, score: Number(x.score) || 0,
    content: String(x.content || ''), raw: String(x.raw_content || '').slice(0, 60000)
  }));
  await store.set(key, results, 12 * 3600);
  return results;
}

/**
 * Run the research for the latest message.
 * Returns { available, ran, capped?, failed?, queries, sources:[{n,title,uri,host,kind}], context }
 */
async function research(msgs, { onStatus } = {}) {
  if (!configured()) return { available: false };
  const plan = await planSearch(msgs);
  if (!plan.search) return { available: true, ran: false };
  if (onStatus) onStatus('Searching the web and insurers\u2019 websites\u2026');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), parseInt(process.env.SEARCH_TIMEOUT_MS || '9000', 10));
  try {
    const jobs = plan.queries.map(q => tavilyOnce(q, [], ctl.signal));
    if (plan.official_domains.length) jobs.push(tavilyOnce(plan.queries[0], plan.official_domains, ctl.signal));
    const settled = await Promise.allSettled(jobs);
    const ok = settled.filter(s => s.status === 'fulfilled');
    if (!ok.length) {
      const err = settled.find(s => s.status === 'rejected').reason;
      return { available: true, ran: true, failed: true, capped: err && err.code === 'CAP', error: err && err.message, queries: plan.queries };
    }

    // merge, de-duplicate, rank: official insurer and regulator pages first, at most two pages per site
    // the same page can come back from more than one search: keep the copy with the most text and the best score
    const byUrl = new Map();
    ok.forEach(s => s.value.forEach(x => {
      const prev = byUrl.get(x.url);
      if (!prev) { byUrl.set(x.url, { ...x }); return; }
      if ((x.raw.length + x.content.length) > (prev.raw.length + prev.content.length)) { prev.raw = x.raw; prev.content = x.content; }
      prev.score = Math.max(prev.score, x.score);
    }));
    const all = [...byUrl.values()];
    const boost = { insurer: 0.35, regulator: 0.3, other: 0 };
    all.forEach(x => { x.host = hostOf(x.url); x.kind = kindOf(x.host); x.rank = x.score + boost[x.kind]; });
    all.sort((a, b) => b.rank - a.rank);
    const perHost = {}; const chosen = [];
    for (const x of all) {
      perHost[x.host] = (perHost[x.host] || 0) + 1;
      if (perHost[x.host] <= 2) chosen.push(x);
      if (chosen.length >= 6) break;
    }

    const q = plan.queries.join(' ');
    const sources = chosen.map((x, i) => {
      const body = excerpt(x.raw, q, 2000);
      const text = safeText([x.content && !body.includes(x.content.slice(0, 60)) ? x.content : '', body].filter(Boolean).join('\n')).slice(0, 2400);
      return { n: i + 1, title: x.title, uri: x.url, host: x.host, kind: x.kind, text };
    }).filter(s => s.text.length > 20);
    sources.forEach((s, i) => { s.n = i + 1; });
    if (!sources.length) return { available: true, ran: true, queries: plan.queries, sources: [], context: '' };

    const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const context = `<web_sources retrieved="${today}">\n` + sources.map(s =>
      `[${s.n}] ${safeText(s.title)} (${s.host}${s.kind === 'insurer' ? ', official insurer website' : s.kind === 'regulator' ? ', official regulator or government website' : ', third-party website'})\n${s.text}`
    ).join('\n\n') + '\n</web_sources>';
    return { available: true, ran: true, queries: plan.queries, sources: sources.map(({ text, ...s }) => s), context };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { research, configured, planSearch, excerpt, kindOf, hostOf, tavilyKey };
