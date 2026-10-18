/**
 * One conversation pipeline shared by WhatsApp and SMS:
 * human take-over check -> assistant reply -> save history -> alert the owner if a human is needed.
 */
const store = require('./store');
const { askAssistant } = require('./assistant');
const { alertOwner } = require('./notify');

const takeoverSec = () => Math.round(parseFloat(process.env.TAKEOVER_HOURS || '6') * 3600);

const HANDOFF = {
  whatsapp: 'Thank you. I have alerted a team member at InsuriCare, who will follow up with you shortly. If it is urgent, kindly call +254 115 129 088. Regards',
  sms: 'Thank you. A team member at InsuriCare will follow up shortly. If urgent, call +254115129088. Regards'
};
const LABEL = { whatsapp: 'WhatsApp', sms: 'SMS' };
const link = (channel, id) => (channel === 'whatsapp' ? `https://wa.me/${id}` : `tel:+${id}`);

/**
 * @param channel 'whatsapp' | 'sms'
 * @param id      client's number, digits only
 * @param reply   async (text) => sends text to the client
 * @param replyAudio optional async (url) => sends an audio reply
 */
async function converse({ channel, id, name = '', text = '', audio = null, reply, replyAudio }) {
  const key = k => `${k}:${channel}:${id}`;
  const who = name || id;

  const takeover = await store.get(key('takeover'));
  if (takeover) {
    if (!(await store.get(key('nudge')))) {
      await store.set(key('nudge'), 1, 1800);
      await alertOwner({
        urgency: takeover.urgency,
        title: `${who} sent a new ${LABEL[channel]} message`,
        lines: [`Chat: ${link(channel, id)}`, text ? `Message: ${text.slice(0, 300)}` : 'Message: voice note']
      });
    }
    return { skipped: true };
  }

  const history = (await store.get(key('hist'))) || [];
  const result = await askAssistant({ channel, phone: id, name, text, audio, history });

  await reply(result.reply);
  if (result.audio_url && replyAudio) {
    try { await replyAudio(result.audio_url); } catch (e) { console.error('audio reply failed:', e.message); }
  }

  const said = text || result.heard || (audio ? '[voice note]' : '');
  await store.set(key('hist'), [...history, { role: 'user', text: said }, { role: 'assistant', text: result.reply }].slice(-14), 7 * 86400);

  if (result.escalate) {
    await alertOwner({
      urgency: result.urgency,
      title: `${name || 'Client'} needs you on ${LABEL[channel]}`,
      lines: [
        `Client: ${name ? name + ' ' : ''}+${id}`,
        `Why: ${result.reasons.join('; ') || 'needs a human'}`,
        said ? `Message: ${said.slice(0, 300)}` : null,
        `${channel === 'whatsapp' ? 'Reply' : 'Call or text'}: ${link(channel, id)}`
      ]
    });
    await store.set(key('takeover'), { urgency: result.urgency, at: Date.now() }, takeoverSec());
    if (!/team member|alerted/i.test(result.reply)) await reply(HANDOFF[channel] || HANDOFF.whatsapp);
  }
  return { result };
}

module.exports = { converse, HANDOFF };
