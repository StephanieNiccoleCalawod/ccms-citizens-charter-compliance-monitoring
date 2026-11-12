// Sprint 6 TT1: seeded history v2 (CCCMS_SEED_PLAN_V2_11082026.md; spec 2.5; decisions K11, K15-K17). Demo only.
// Every number of the plan lives here, so the dry run, the import and the tests read one source.

// Bump when the planning algorithm or any default below changes: it is printed and stored with every run, so a
// reproduction compares like with like.
export const ALGORITHM_VERSION = 'tt1-seed-v2.1';

export const DEFAULTS = Object.freeze({
  from: '2026-07-01',
  to: '2026-11-06',
  volume: 700,
  seed: 'cccms-seed-plan-v2',
  openTarget: 50,
});

export const OPEN_MIN = 40;
export const OPEN_MAX = 60;
export const OPEN_WORKING_DAYS = 5;

// Plan 1: completed transactions per month for the default period (07/01 to 11/06/2026). Other periods are scaled by the
// same per-day density (see planner monthTargets()).
export const MONTH_TARGETS = Object.freeze({ '2026-07': 100, '2026-08': 170, '2026-09': 130, '2026-10': 250, '2026-11': 50 });
// The calendar days each default month target covers (November stops on 11/06).
export const MONTH_TARGET_DAYS = Object.freeze({ '2026-07': 31, '2026-08': 31, '2026-09': 30, '2026-10': 31, '2026-11': 6 });

// Plan 1: office shares (percent) and the 700-row counts they give. Office codes are resolved as PUP-<key>.
export const OFFICE_SHARES = Object.freeze([
  ['REG', 22], ['OSAS', 20], ['ADMREG', 18], ['ACAD', 14], ['ADMIN', 14], ['ACCT', 5], ['LIB', 4], ['OSFA', 3],
]);
export const officeCodeOf = (key) => `PUP-${key}`;

// Plan 1: client mix (percent) and the registry misses (about 3% of Student/Alumni rows, K5 reasons).
export const CLIENT_MIX = Object.freeze([['STUDENT', 70], ['ALUMNI', 15], ['EMPLOYEE', 8], ['EXTERNAL', 7]]);
export const CLIENT_MIX_TOLERANCE_POINTS = 2;
export const REGISTRY_MISS_SHARE = 0.03;
export const MISS_REASONS_BY_TYPE = Object.freeze({
  STUDENT: ['NEW_ENROLLEE', 'RETURNING_STUDENT', 'NAME_DIFFERS'],
  ALUMNI: ['OLDER_ALUMNI', 'NAME_DIFFERS'],
});

// Plan 1: "the top fifth gets about 60%; about a third of the services get none".
export const TOP_FIFTH_SHARE = 0.6;
export const UNUSED_SHARE = 1 / 3;

// Plan 1 lateness: 15-18% of completed rows, 110-125 of 700. Other volumes scale the count bounds.
export const LATE_RATE = Object.freeze({ min: 0.15, max: 0.18, target: 0.165 });
export const LATE_COUNT_700 = Object.freeze({ min: 110, max: 125 });

// Plan 2 patterns, by the plan's service codes (resolved as PUP-<code>; a missing or ambiguous one stops the run).
export const PATTERN_CODES = Object.freeze({
  credentialRush: ['REG-CRD-005', 'REG-CRD-002'],
  assembly: 'OSAS-ACT-001',
  assemblyFacilities: ['ADMIN-FAC-001', 'ADMIN-FAC-002'],
  generousStandard: 'OSAS-CRD-007',
  chronicDelay: 'ADMREG-ACC-003',
});
export const patternServiceCode = (code) => `PUP-${code}`;

// The two busiest October weeks (credential rush, pattern 1): Monday 10/12 to Friday 10/23/2026.
export const RUSH_WEEKS = Object.freeze({ from: '2026-10-12', to: '2026-10-23' });
// Late-August Admission and Registrar peak (term start 08/17, pattern 8).
export const AUGUST_PEAK = Object.freeze({ from: '2026-08-10', to: '2026-08-31', offices: ['REG', 'ADMREG'], dayWeight: 2.2 });

export const PATTERN_RATES = Object.freeze({
  rushLate: 0.30, // pattern 1: 25-35%
  chronicLate: 0.30, // pattern 4: about 30%
  acadFirstLate: 0.25, // pattern 5: from about 25% ...
  acadLastLate: 0.08, // ... to about 8%
  assemblyOctoberFactor: 3, // pattern 2: about 3x usual in October
  facilitiesOctoberFactor: 2, // pattern 2: ADMIN-FAC-001/002 rise in October, ease in November
  rushServiceFactor: 2.5, // the rush services are busy in the rush weeks
  unusualCount: 4, // pattern 6: 3 to 5 cases
  unusualMinRowsPerService: 20, // CC054 needs 20 completed transactions per service
});

// Share of the time limit used (f): on-time rows, late rows, the generous standard and the unusual cases.
export const SHARE_RANGES = Object.freeze({
  onTime: [0.25, 0.88],
  late: [1.12, 1.7],
  generous: [0.15, 0.35],
  unusualFactor: [3.5, 6], // times the usual (median on-time) share
  usual: 0.565,
});

// Late-risk levels used to spread the open rows (spec 3.2 rule-based thresholds on the share used).
export const RISK_LEVELS = Object.freeze({ HIGH: 0.8, MEDIUM: 0.5 });

// Reserved tracking-number range (K16).
export const SEED_SEQUENCE = Object.freeze({ first: 9001, last: 9999 });
