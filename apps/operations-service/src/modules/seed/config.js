// Sprint 6 TT1: seeded history v3 (CCCMS_SEED_PLAN_V3_11122026.md, which changes v2 / CCCMS_SEED_PLAN_V2_11082026.md; spec 2.5;
// decisions K11, K15-K17, K32-K34). Demo only.
// Every number of the plan lives here, so the dry run, the import and the tests read one source.

// Bump when the planning algorithm or any default below changes: it is printed and stored with every run, so a
// reproduction compares like with like.
export const ALGORITHM_VERSION = 'tt1-seed-v3.1';

// K33: 01/05 to 11/06/2026, about 1,000 completed rows (about 300 in the lighter first half-year, about 700 from 07/01).
// K32: about 8 open rows, because only about 16 office accounts exist and each holds one open transaction.
export const DEFAULTS = Object.freeze({
  from: '2026-01-05',
  to: '2026-11-06',
  volume: 1000,
  seed: 'cccms-seed-plan-v3',
  openTarget: 8,
});

// The plan's v2 volume (07/01 to 11/06): its late-count bounds (110-125) are kept for that exact volume only.
export const LEGACY_VOLUME = 700;
// Completed rows per calendar day for a month the plan does not list (the v2 plan's overall density).
export const FALLBACK_PER_DAY = 700 / 129;

// K32: the open count follows the number of free accounts (accounts minus one kept free per office for the presenters).
// OPEN_MIN stops a run that could not show a meaningful late-risk list; OPEN_MAX stays a hard cap if many accounts exist.
export const OPEN_MIN = 6;
export const OPEN_MAX = 60;
export const OPEN_WORKING_DAYS = 5;

// Plan 1 / v3: completed transactions per month for the default period (01/05 to 11/06/2026): a lighter first half-year
// (300) and the v2 second half (700). Other periods are scaled by the same per-day density (see planner monthTargets()).
export const MONTH_TARGETS = Object.freeze({
  '2026-01': 45, '2026-02': 40, '2026-03': 45, '2026-04': 55, '2026-05': 60, '2026-06': 55,
  '2026-07': 100, '2026-08': 170, '2026-09': 130, '2026-10': 250, '2026-11': 50,
});
// The calendar days each default month target covers (January starts on 01/05, November stops on 11/06).
export const MONTH_TARGET_DAYS = Object.freeze({
  '2026-01': 27, '2026-02': 28, '2026-03': 31, '2026-04': 30, '2026-05': 31, '2026-06': 30,
  '2026-07': 31, '2026-08': 31, '2026-09': 30, '2026-10': 31, '2026-11': 6,
});

// Plan 1: office shares (percent). They apply to the total volume (1,000 gives 220/200/180/140/140/50/40/30).
// Office codes are resolved as PUP-<key>.
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

// Plan 1 lateness: 15-18% of completed rows (150-180 of 1,000; the v2 volume of 700 keeps 110-125). Other volumes scale.
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

// v3 (K34): services nobody is registered to handle get no rows (no dentist account exists, so the dental services stay unused).
export const EXCLUDED_SERVICE_PREFIXES = Object.freeze(['PUP-ADMIN-DEN-']);

// v3 (K34): who handles which service. Started by / Completed by come from this list, not from a random account of the office.
// `who` are full names as registered in Identity (compared without case, spaces or punctuation). `services` are service
// codes without the "PUP-" prefix; a trailing * means "every service starting with". Several people for one service share it.
// An account that is missing or inactive is reported and the rows fall back to any active account of the same office.
export const ASSIGNMENTS = Object.freeze([
  { office: 'ADMIN', who: ['Ma.Eugenia Halili'], services: ['ADMIN-MED-*', 'ADMIN-CLR-*'] },
  { office: 'ADMIN', who: ['John Robert Isip'], services: ['ADMIN-FAC-*', 'ADMIN-CIR-001'] },
  { office: 'OSAS', who: ['Melanie Bactasa'], services: ['OSAS-CNS-*', 'OSAS-REC-*'] },
  // Identity has the same OSAS Head (QA-2026-0001) registered with this spelling.
  { office: 'OSAS', who: ['Alma C. Fernandez'], aliases: { 'Alma C. Fernandez': ['Alma C. Fernadez'] }, services: ['OSAS-ACT-001', 'OSAS-CRD-*', 'OSAS-IDC-*'] },
  { office: 'LIB', who: ['Jean-Paul De Guzman', 'Jann Liongson'], services: ['LIB-CIR-*'] },
  { office: 'LIB', who: ['Klaribel Domingo'], services: ['LIB-REF-*'] },
  { office: 'ACCT', who: ['Hernando Liberato'], services: ['ACCT-CLR-*'] },
  { office: 'ACCT', who: ['Rosalinda Madelo'], services: ['ACCT-FIN-*'] },
  { office: 'REG', who: ['Meryl Gonzalbo'], services: ['REG-*'] },
  { office: 'ADMREG', who: ['Berna Bulawit'], services: ['ADMREG-ADM-*'] },
  { office: 'ADMREG', who: ['Cherryln Esparagoza'], services: ['ADMREG-ACC-*', 'ADMREG-GRD-*', 'ADMREG-CRD-*', 'ADMREG-VER-*'] },
  { office: 'ACAD', who: ['Ednalyn Bataller'], services: ['ACAD-ENR-*', 'ACAD-PET-*'] },
  { office: 'ACAD', who: ['Mark Aribon'], services: ['ACAD-GRD-*', 'ACAD-SHF-*'] },
  { office: 'OSFA', who: ['Geronimo Cuadra'], services: ['OSFA-*'] },
]);
