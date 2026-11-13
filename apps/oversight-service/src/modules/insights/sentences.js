// CC053: the insight sentences, as in the Sprint 5-8 technical specification, section 3.3 (E1). They are FIXED TEMPLATES, not a
// language model (H4, I15): each one is a pure function of numbers that are also on the linked chart. The server sends the
// template number and its numbers (`params`, with ids, never names: names belong to the catalogue); the screen writes the words
// (frontend lib/ui/insights.js) from the same params, so a sentence and its chart cannot disagree.
//
//   1  "{Office} requests are expected to rise {x}% next week"   forecast weekly total vs the last 5 working days, x >= 20
//   2  "{Service} was late {x}% of the time in {period}"         x >= 20 and completed >= 20 (B-11)
//   3  "{Office}'s late rate fell (rose) from {a}% to {b}%"      first vs last third of the period, change >= 10 points, completed >= 30
//   4  "{Service} is usually done in {x}% of its time limit"     90th percentile below 25% of the limit, completed >= 20 (B-11)
//   5  "{n} unusual cases took more than three times the usual time"   n >= 1 (B-10, CC054)
//   6  "{n} open transactions are at high risk of being late"    n >= 1
//
// Templates 1 and 6 need Operations (the request forecast and the late-risk model), which Oversight holds no copy of: the screen
// builds those two from Operations' answers and ranks all candidates together. This file builds 2 to 5 and gives each a `score`.
// Ranking is effect x volume (the spec gives no formula beyond that; the score is written next to each template below, and the
// same rule is used on the screen for 1 and 6). Up to MAX_SENTENCES are shown.
export const MAX_SENTENCES = 6;
export const MIN_CELL_COMPLETED = 5;
export const MIN_SERVICE_COMPLETED = 20;
export const MIN_OFFICE_COMPLETED = 30;
export const LATE_RATE_MIN = 20;
export const LATE_RATE_CHANGE_MIN = 10;

export const TEMPLATES = Object.freeze({
  FORECAST_RISE: 1, // built on the screen (Operations forecast)
  SERVICE_LATE: 2,
  OFFICE_TREND: 3,
  SERVICE_FAST: 4,
  UNUSUAL: 5,
  HIGH_RISK: 6, // built on the screen (Operations late-risk)
});

const oneDecimal = (v) => Math.round(v * 10) / 10;

/**
 * input: {
 *   services: [{ service_id, service_code, completed, late }],                         over the period (completed = on time + late)
 *   officeTrend: [{ office_id, completed, first_completed, first_late, last_completed, last_late }],
 *   charter: { services: [{ office_id, service_id, service_code, completed, p90_share_of_limit, flags }], unusual: [...] },
 *   period: 'weekly' | 'monthly' | 'half_year' | 'annual' | 'custom',
 * }
 * Returns candidates [{ id, template, kind, chart, score, params }] ranked, NOT cut: the screen adds 1 and 6, then cuts to MAX_SENTENCES.
 */
export function buildSentences(input) {
  const out = [];
  const add = (template, id, kind, chart, score, params) => out.push({ id, template, kind, chart, score, params });

  // 2: effect = late rate, volume = completed, so the score is the number of late transactions.
  for (const s of input.services) {
    if (s.completed < MIN_SERVICE_COMPLETED) continue;
    const lateRate = oneDecimal((s.late / s.completed) * 100);
    if (lateRate < LATE_RATE_MIN) continue;
    add(TEMPLATES.SERVICE_LATE, `t2-${s.service_id}`, 'warning', 'heatmap', s.late, { service_id: s.service_id, service_code: s.service_code, late_rate: lateRate, late: s.late, completed: s.completed, period: input.period });
  }

  // 3: effect = change in points, volume = completed in the period.
  for (const o of input.officeTrend) {
    if (o.completed < MIN_OFFICE_COMPLETED || !o.first_completed || !o.last_completed) continue;
    const from = oneDecimal((o.first_late / o.first_completed) * 100);
    const to = oneDecimal((o.last_late / o.last_completed) * 100);
    const change = oneDecimal(to - from);
    if (Math.abs(change) < LATE_RATE_CHANGE_MIN) continue;
    add(TEMPLATES.OFFICE_TREND, `t3-${o.office_id}`, change < 0 ? 'positive' : 'warning', 'pulse', (Math.abs(change) / 100) * o.completed, { office_id: o.office_id, from_rate: from, to_rate: to, change, direction: change < 0 ? 'fell' : 'rose', completed: o.completed });
  }

  // 4: effect = how much of the limit is unused, volume = completed. Uses the Charter check's own flag (same 25% rule, same 20 minimum).
  for (const s of input.charter.services) {
    if (!s.flags.includes('LIMIT_FAR_LONGER') || s.p90_share_of_limit === null) continue;
    add(TEMPLATES.SERVICE_FAST, `t4-${s.office_id}-${s.service_id}`, 'positive', 'charter', ((100 - s.p90_share_of_limit) / 100) * s.completed, { office_id: s.office_id, service_id: s.service_id, service_code: s.service_code, share_of_limit: s.p90_share_of_limit, completed: s.completed });
  }

  // 5: one sentence for all unusual cases in scope. effect = the cases, volume = 1 each, so the score is n.
  const n = input.charter.unusual.length;
  if (n >= 1) add(TEMPLATES.UNUSUAL, 't5', 'attention', 'charter', n, { n });

  return out.sort((a, b) => b.score - a.score || a.template - b.template || String(a.id).localeCompare(String(b.id)));
}

/** The six rank by the same rule on the screen: highest score first, then template order. */
export const rankSentences = (candidates) => [...candidates].sort((a, b) => b.score - a.score || a.template - b.template).slice(0, MAX_SENTENCES);
