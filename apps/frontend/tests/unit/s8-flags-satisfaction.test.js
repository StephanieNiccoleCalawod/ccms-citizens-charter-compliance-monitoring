import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildDashboardTabs } from '../../src/lib/ui/insights.js';
import { hasSatisfaction, holdMinutesText, lowRatingRows, rateText, satisfactionRows, scopedCaseFlags, starsText, withSatisfactionTab } from '../../src/lib/ui/case-flags.js';

const OFFICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OFFICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const items = [
  { service_id: 's1', office_id: OFFICE_A, service_name: 'Zeta', count: 12, average: 2.5, enough_ratings: true, response_rate: 40, flags: ['LOW_RATING'] },
  { service_id: 's2', office_id: OFFICE_B, service_name: 'Alpha', count: 3, average: 1.2, enough_ratings: false, response_rate: 10, flags: [] },
  { service_id: 's3', office_id: OFFICE_A, service_name: 'Beta', count: 20, average: 4.6, enough_ratings: true, response_rate: 55.5, flags: [] },
];

describe('S8 flags 4 to 6 and Client Satisfaction (FE)', () => {
  it('the Client Satisfaction tab appears only when there are ratings, with the low count', () => {
    const base = buildDashboardTabs({});
    assert.equal(withSatisfactionTab(base, false), base);
    const tabs = withSatisfactionTab(base, true, 2);
    assert.equal(tabs.at(-1).label, 'Client Satisfaction');
    assert.equal(tabs.at(-1).badge, '2');
    assert.equal(hasSatisfaction([]), false);
    assert.equal(hasSatisfaction(items), true);
  });
  it('low-rating rows come first, and an office head sees only their office', () => {
    assert.deepEqual(satisfactionRows(items).map((r) => r.service_id), ['s1', 's2', 's3']);
    const scoped = satisfactionRows(items, { kind: 'office', officeId: OFFICE_B });
    assert.deepEqual(scoped.map((r) => r.service_id), ['s2']);
    assert.deepEqual(lowRatingRows(items).map((r) => r.service_id), ['s1']);
  });
  it('holds and cancellations follow the office scope', () => {
    const overview = { charter: { long_holds: [{ transaction_id: 'x', office_id: OFFICE_A }, { transaction_id: 'y', office_id: OFFICE_B }], many_cancelled: [{ office_id: OFFICE_B, days: [] }] } };
    const { holds, cancellations } = scopedCaseFlags(overview, { kind: 'office', officeId: OFFICE_A });
    assert.deepEqual(holds.map((h) => h.transaction_id), ['x']);
    assert.equal(cancellations.length, 0);
  });
  it('wording', () => {
    assert.equal(holdMinutesText(560), '9 h 20 min');
    assert.equal(holdMinutesText(45), '45 min');
    assert.equal(starsText(2.5), '2.5 / 5');
    assert.equal(starsText(null), '-');
    assert.equal(rateText(40), '40%');
    assert.equal(rateText(55.5), '55.5%');
  });
  it('the screen says satisfaction is not timeliness and "not enough ratings yet"', () => {
    const src = readFileSync(new URL('../../src/components/dashboard/ClientSatisfactionPanel.js', import.meta.url), 'utf8');
    assert.ok(src.includes('NOT_ENOUGH_RATINGS') && src.includes('SATISFACTION_NOTE'));
    assert.match(readFileSync(new URL('../../src/lib/ui/case-flags.js', import.meta.url), 'utf8'), /Satisfaction, not timeliness/);
  });
});
