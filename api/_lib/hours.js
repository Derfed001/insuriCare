// Office hours in Nairobi time (EAT = UTC+3). Keys: 0=Sun ... 6=Sat. Keep in sync with OFFICE_HOURS in index.html,
// or set OFFICE_HOURS_JSON, e.g. {"1":[8,17],"6":[9,13]}
const DEFAULT = { 1: [8, 17], 2: [8, 17], 3: [8, 17], 4: [8, 17], 5: [8, 17], 6: [9, 13] };

function hours() {
  try { return process.env.OFFICE_HOURS_JSON ? JSON.parse(process.env.OFFICE_HOURS_JSON) : DEFAULT; }
  catch { return DEFAULT; }
}
function isOpenEAT(nowMs = Date.now()) {
  const n = new Date(nowMs + 3 * 3600 * 1000);
  const w = hours()[n.getUTCDay()];
  if (!w) return false;
  const h = n.getUTCHours() + n.getUTCMinutes() / 60;
  return h >= w[0] && h < w[1];
}
module.exports = { isOpenEAT };
