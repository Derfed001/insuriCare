const { classify, maxUrgency } = require('./util');
const { buildStyle } = require('./persona');

const FALLBACK_REPLY =
  "Thank you for reaching out to InsuriCare. A team member will respond to you shortly. " +
  "If it is urgent, kindly call +254 115 129 088. Regards";

const BASE_PROMPT = `You are the AI assistant for InsuriCare Insurance Agency, an independent insurance agency in Utawala, Nairobi, Kenya (Marafiki Court, Room E3). Phone/WhatsApp: +254 115 129 088. Email: insuricareagency@gmail.com.

IDENTITY
- You are an AI assistant, not a human. Say so plainly if asked, and in your first message to a new client.
- Never claim to be the agency owner or any named person.

WHAT THE AGENCY ARRANGES
Personal: investment plans, savings plans, education plans, retirement planning, pension transfer and consolidation, life insurance, unit trusts (MMF), car insurance, personal accident, individual medical, travel, professional indemnity, trust fund.
Group: WIBA, group professional indemnity, corporate medical, group pension, group accident, group life, credit life, property, domestic package, contractor's all risk, marine, transit goods, contracting out of NSSF Tier 2.
Underwriting partners: Britam, CIC Group, Jubilee Insurance, The Monarch Insurance, Definite Assurance, APA Insurance, Heritage Insurance, ICEA LION Group, Old Mutual, Sanlam Allianz.

HOW TO BEHAVE
- Keep replies short enough for WhatsApp (about 1-5 sentences). No markdown formatting.
- For a quote, collect the basics one or two questions at a time: what they want covered, who or what (age and number of dependants; car make, year and value; number of staff), and their budget or preferred insurer.
- Explain products in plain language. You may describe how a cover generally works.
- NEVER state exact premiums, guarantee that a claim will be paid, confirm that cover is in force, give legal or medical advice, or ask for card numbers, PINs, passwords or M-Pesa PINs.
- If you do not know something, say a team member will confirm. Do not invent policy terms, prices or insurer rules.

WHEN A HUMAN IS NEEDED (set escalate = true)
Claims or incidents (accident, theft, hospital, death), complaints or anger, a request to speak to a person or get a call, a client ready to buy, pay or sign, group or corporate enquiries (about 10+ people), anything you cannot answer confidently. When escalating, tell the client a team member will follow up and that they can call +254 115 129 088 if urgent.

OUTPUT
Return ONLY JSON: {"reply": string, "escalate": boolean, "urgency": "urgent"|"high"|"normal", "reason": string, "heard": string}
"reason" is a short note for the agency owner summarising what the client needs. Keep it under 160 characters.
"heard" is only for audio: a one or two sentence transcript of what the client said (English or Kiswahili). Leave it empty for text.`;

/** Full system prompt = facts and rules + the owner's client-mode writing style + conversation state. */
function buildSystemPrompt({ channel = 'whatsapp', firstMessage = true, nowMs = Date.now() } = {}) {
  return BASE_PROMPT + '\n\n' + buildStyle({ channel, firstMessage, nowMs });
}

function parseModelJson(text) {
  const t = String(text || '').replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const o = JSON.parse(t);
    if (o && typeof o.reply === 'string') return o;
  } catch (_) { /* fall through */ }
  return t ? { reply: t, escalate: false, urgency: 'normal', reason: '' } : null;
}

async function withTimeout(ms, fn) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try { return await fn(ctl.signal); } finally { clearTimeout(timer); }
}

async function viaCustomAssistant(payload) {
  const r = await withTimeout(25000, signal => fetch(process.env.ASSISTANT_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.ASSISTANT_TOKEN ? { Authorization: `Bearer ${process.env.ASSISTANT_TOKEN}` } : {})
    },
    body: JSON.stringify(payload)
  }));
  if (!r.ok) throw new Error('assistant ' + r.status);
  const o = await r.json();
  if (typeof o.reply !== 'string') throw new Error('assistant returned no reply');
  return o;
}

async function viaGemini({ history, text, audio, channel }) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const contents = (history || []).map(h => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] }));
  const parts = [];
  if (audio) parts.push({ inline_data: { mime_type: String(audio.mime).split(';')[0], data: audio.base64 } });
  parts.push({ text: text || '(voice note: transcribe it, then answer it)' });
  contents.push({ role: 'user', parts });

  const r = await withTimeout(25000, signal => fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: buildSystemPrompt({ channel, firstMessage: !(history && history.length) }) }] },
        contents,
        generationConfig: { temperature: 0.4, maxOutputTokens: 500, responseMimeType: 'application/json' }
      })
    }));
  if (!r.ok) throw new Error('gemini ' + r.status);
  const data = await r.json();
  const out = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  const o = parseModelJson(out);
  if (!o) throw new Error('empty gemini reply');
  return o;
}

/**
 * Ask the assistant to answer a client's message.
 * Priority: your own assistant service (ASSISTANT_URL) -> Gemini -> safe fallback.
 * Returns { reply, audio_url?, escalate, urgency, reasons[] }
 */
async function askAssistant({ channel = 'whatsapp', phone, name, text, audio, history = [] }) {
  const rules = classify(text);
  let model = null;
  try {
    const firstMessage = !history.length;
    if (process.env.ASSISTANT_URL) {
      try {
        model = await viaCustomAssistant({ channel, phone, name, text, audio, history, first_message: firstMessage, system_prompt: buildSystemPrompt({ channel, firstMessage }) });
      } catch (err) {
        // Your own agent (e.g. a Colab tunnel) can be offline. Fall back to Gemini when a key is set.
        console.error('custom assistant failed:', err.message);
        if (!process.env.GEMINI_API_KEY) throw err;
      }
    }
    if (!model && process.env.GEMINI_API_KEY) model = await viaGemini({ history, text, audio, channel });
  } catch (err) {
    console.error('assistant error:', err.message);
  }

  if (!model) {
    return { reply: FALLBACK_REPLY, escalate: true, urgency: rules.urgency || 'high', reasons: ['assistant unavailable', ...rules.reasons] };
  }

  const modelUrgency = model.urgency === 'urgent' || model.urgency === 'high' ? model.urgency : null;
  const escalate = !!(model.escalate || rules.urgency);
  const urgency = escalate ? (maxUrgency(rules.urgency, modelUrgency) || 'high') : null;
  const reasons = [...rules.reasons];
  if (model.reason) reasons.push(String(model.reason).slice(0, 200));
  return { reply: String(model.reply).slice(0, 1500), audio_url: model.audio_url, heard: model.heard ? String(model.heard).slice(0, 400) : '', escalate, urgency, reasons };
}

/** One-paragraph brief for the owner before a call-back. */
async function callBrief({ name, cover, notes }) {
  const base = `${name} wants a call about ${cover}.` + (notes ? ` Notes: ${notes}` : '');
  if (!process.env.GEMINI_API_KEY) return base;
  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await withTimeout(15000, signal => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text:
            `You brief an insurance agent before a call-back. In at most 2 short sentences, state what the client wants and the 2-3 questions to ask first. No markdown.\nClient: ${name}\nCover: ${cover}\nNotes: ${notes || 'none'}` }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 160 }
        })
      }));
    if (!r.ok) throw new Error('gemini ' + r.status);
    const out = (await r.json())?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
    return out ? `${base}\nBrief: ${out}` : base;
  } catch (e) {
    console.error('brief error:', e.message);
    return base;
  }
}

/** Short transcript/summary of a voicemail so the owner can read it instead of listening. */
async function voicemailBrief(audio) {
  if (!audio || !process.env.GEMINI_API_KEY) return '';
  try {
    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const r = await withTimeout(20000, signal => fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [
            { inline_data: { mime_type: String(audio.mime).split(';')[0], data: audio.base64 } },
            { text: 'This is a voicemail left for an insurance agency in Kenya (English or Kiswahili). In at most 2 short sentences in English, state the caller name if given, what they want, and any number or time they mention. No markdown.' }
          ] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 160 }
        })
      }));
    if (!r.ok) throw new Error('gemini ' + r.status);
    return ((await r.json())?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '').trim();
  } catch (e) {
    console.error('voicemail brief error:', e.message);
    return '';
  }
}

module.exports = { askAssistant, callBrief, voicemailBrief, buildSystemPrompt, FALLBACK_REPLY };
