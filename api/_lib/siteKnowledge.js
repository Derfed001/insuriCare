/**
 * The assistant "reads" the InsuriCare website: the text of index.html is extracted and given to the model,
 * so it answers agency questions (services, steps, claims, checklists, FAQs, contacts) from your own pages.
 * vercel.json ships index.html with the functions (includeFiles).
 */
const fs = require('fs');
const path = require('path');
const { describeHours } = require('./hours');

const MAX = 15000;
let cache = null;

const FALLBACK = `InsuriCare Insurance Agency, Marafiki Court Room E3, Utawala, Nairobi. Phone and WhatsApp +254 115 129 088. Email insuricareagency@gmail.com.
Arranges personal and group insurance with Britam, CIC Group, Jubilee Insurance, The Monarch Insurance, Definite Assurance, APA Insurance, Heritage Insurance, ICEA LION Group, Old Mutual and Sanlam Allianz.`;

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '(c)', rarr: '->', middot: '-', hellip: '...', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
const decode = s => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => (ENT[n.toLowerCase()] !== undefined ? ENT[n.toLowerCase()] : m));

function htmlToText(html) {
  let s = html
    .replace(/<!-- ===== Website chatbot ===== -->[\s\S]*?<div id="printArea"[^>]*><\/div>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|template|form|select|textarea|button|iframe|video)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|li|ul|ol|h[1-6]|section|article|tr|header|footer|nav|details|summary|dt|dd|blockquote|main)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decode(s);
  const seen = new Set();
  const out = [];
  for (const raw of s.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line || line.length < 2) continue;
    if (line.length < 70) { if (seen.has(line)) continue; seen.add(line); }
    out.push(line);
  }
  return out.join('\n');
}

function getSiteKnowledge() {
  if (cache) return cache;
  let text = '';
  for (const f of [path.join(process.cwd(), 'index.html'), path.join(__dirname, '..', '..', 'index.html')]) {
    try { text = htmlToText(fs.readFileSync(f, 'utf8')); if (text) break; } catch (_) { /* try next */ }
  }
  if (!text) console.error('siteKnowledge: index.html not found, using a short fallback');
  cache = (text || FALLBACK).slice(0, MAX) + '\n' + describeHours();
  return cache;
}

module.exports = { getSiteKnowledge, htmlToText };
