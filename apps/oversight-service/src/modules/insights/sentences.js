// CC053: the insight sentences. They are FIXED TEMPLATES, not a language model: each one is a pure function of numbers that are
// also on the linked chart. The server sends the template id and its numbers (`params`, with ids, never names: names belong to
// the catalogue); the screen writes the words (frontend lib/ui/insights.js) from the same params, so the sentence and its chart
// cannot disagree.
//
// PROPOSED TEMPLATES, to be checked against the spec (Sprint 5-8 technical specification, section 3.3): the spec file was not
// available when these were written. Thresholds that are not in the backlog (5 completed for a heatmap cell) are the backlog's own.
// Ranking: effect x volume (score), highest first, up to MAX_SENTENCES. Sentence 5 (CHARTER) only exists when CC054 found a flag.
import { FLAG_FAR_LONGER, FLAG_OFTEN_MISSED } from './charter.js';

export const MAX_SENTENCES = 6;
export const MIN_CELL_COMPLETED = 5;

export const TEMPLATES = Object.freeze({
  BOTTLENECK: 1, // the heatmap cell with the highest late rate
  TREND: 2, // on-time rate against the previous period of the same length
  LATE_SERVICE: 3, // the service with the most late transactions
  OFFICE_GAP: 4, // the office furthest below the 100% target (campus), or this office against it
  CHARTER: 5, // a Charter limit often missed / far longer than real work (CC054)
  AUTO_CLOSED: 6, // transactions closed by the system after the maximum working days (counted late, K27)
});

/**
 * input: { scope: 'campus'|'office', heatmap: [{office_id, service_id, service_code, completed, late, late_rate}],
 *          offices: [{office_id, completed, late, on_time_rate}], services: [{service_id, service_code, completed, late}],
 *          totals: { on_time_rate, previous_on_time_rate, results }, charter: {services}, auto_closed, received }
 */
export function buildSentences(input) {
  const out = [];
  const add = (template, kind, chart, score, params) => out.push({ id: `t${template}`, template, kind, chart, score, params });

  const cells = input.heatmap.filter((c) => c.completed >= MIN_CELL_COMPLETED && c.late > 0).sort((a, b) => b.late_rate - a.late_rate || b.late - a.late);
  if (cells[0]) add(TEMPLATES.BOTTLENECK, 'warning', 'heatmap', cells[0].late, { office_id: cells[0].office_id, service_id: cells[0].service_id, service_code: cells[0].service_code, late_rate: cells[0].late_rate, late: cells[0].late, completed: cells[0].completed });

  const t = input.totals;
  if (t.on_time_rate !== null && t.previous_on_time_rate !== null && t.on_time_rate !== t.previous_on_time_rate) {
    const change = Math.round((t.on_time_rate - t.previous_on_time_rate) * 10) / 10;
    add(TEMPLATES.TREND, change > 0 ? 'positive' : 'warning', 'pulse', Math.abs(change) * (t.results ?? 0) / 100, { on_time_rate: t.on_time_rate, previous_on_time_rate: t.previous_on_time_rate, change });
  }

  const lateService = [...input.services].filter((s) => s.late > 0).sort((a, b) => b.late - a.late || b.completed - a.completed)[0];
  if (lateService) add(TEMPLATES.LATE_SERVICE, 'attention', 'heatmap', lateService.late, { service_id: lateService.service_id, service_code: lateService.service_code, late: lateService.late, completed: lateService.completed });

  const rated = input.offices.filter((o) => o.on_time_rate !== null && o.completed >= MIN_CELL_COMPLETED && o.on_time_rate < 100);
  const gap = [...rated].sort((a, b) => a.on_time_rate - b.on_time_rate || b.completed - a.completed)[0];
  if (gap) add(TEMPLATES.OFFICE_GAP, 'attention', 'pulse', (100 - gap.on_time_rate) * gap.completed / 100, { scope: input.scope, office_id: gap.office_id, on_time_rate: gap.on_time_rate, completed: gap.completed });

  const flagged = input.charter.services.filter((s) => s.flags.includes(FLAG_OFTEN_MISSED) || s.flags.includes(FLAG_FAR_LONGER))
    .sort((a, b) => (b.flags.includes(FLAG_OFTEN_MISSED) ? b.late : 0) - (a.flags.includes(FLAG_OFTEN_MISSED) ? a.late : 0) || b.completed - a.completed)[0];
  if (flagged) {
    const flag = flagged.flags.includes(FLAG_OFTEN_MISSED) ? FLAG_OFTEN_MISSED : FLAG_FAR_LONGER;
    add(TEMPLATES.CHARTER, 'attention', 'charter', flagged.completed * (flag === FLAG_OFTEN_MISSED ? flagged.late_rate / 100 : 0.2), { office_id: flagged.office_id, service_id: flagged.service_id, service_code: flagged.service_code, flag, late_rate: flagged.late_rate, p90_share_of_limit: flagged.p90_share_of_limit, completed: flagged.completed });
  }

  if (input.auto_closed > 0) add(TEMPLATES.AUTO_CLOSED, 'attention', 'pulse', input.auto_closed, { auto_closed: input.auto_closed, received: input.received });

  return out.sort((a, b) => b.score - a.score || a.template - b.template).slice(0, MAX_SENTENCES)
    .map(({ score, ...sentence }) => sentence);
}
