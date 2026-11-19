// CC039 / CC040 queue helpers (pure, tested in tests/unit/queue.test.js).
import { ROLES } from 'ccms-shared/roles';

export const PRIORITY_OPTIONS = Object.freeze([
  { value: '', label: 'No, regular line' },
  { value: 'SENIOR_CITIZEN', label: 'Senior citizen' },
  { value: 'PWD', label: 'Person with disability' },
  { value: 'PREGNANT', label: 'Pregnant' },
]);

export const QUEUE_PAGE_ROLES = Object.freeze([ROLES.SUPER_ADMIN, ROLES.OFFICE_HEAD, ROLES.OFFICE_STAFF]);
export const queueNav = (role) => (QUEUE_PAGE_ROLES.includes(role) ? { section: 'Main', label: 'Queue', href: '/queue' } : null);

export const laneLabel = (lane) => (lane === 'PRIORITY' ? 'Priority' : 'Regular');

/** "Skip available in 1:05" / "Skip available now" for a called ticket, from the server's skippable_at and the clock. */
export function skipCountdown(ticket, nowMs) {
  if (!ticket?.skippable_at) return null;
  const left = Date.parse(ticket.skippable_at) - nowMs;
  if (!(left > 0)) return { ready: true, text: 'Skip is available now' };
  const seconds = Math.ceil(left / 1000);
  return { ready: false, text: `Skip available in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` };
}

/** What the public page says after a failed request. */
export function describeTakeFailure(error) {
  if (error?.status === 429) {
    const wait = error.retryAfterSeconds;
    const minutes = wait ? Math.ceil(wait / 60) : null;
    return { message: `Too many tickets were requested from this device.${minutes ? ` Please try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.` : ' Please wait a moment and try again.'}`, fields: {} };
  }
  if (error?.status === 400 && error.details) {
    const fields = {};
    if (error.details.office_id) fields.office_id = error.details.office_id;
    if (error.details.priority_group) fields.priority_group = error.details.priority_group;
    return { message: Object.keys(fields).length ? '' : error.message, fields };
  }
  if (error?.status === 503) return { message: 'Tickets cannot be issued right now. Please try again in a few minutes or ask the office staff.', fields: {} };
  return { message: error?.message || 'Something went wrong. Please try again.', fields: {} };
}

/**
 * CC040: the choices of the ticket picker on the Start form, from the queue board of the service's office. Called tickets first
 * (the usual choice, newest call first), then the waiting line in call order. Each label is the display number only.
 */
export function ticketPickerOptions(board) {
  const called = (board?.called ?? []).map((t) => ({ value: t.ticket_id, label: `${t.ticket_no} (called now${t.lane === 'PRIORITY' ? ', priority' : ''})`, called: true }));
  const waiting = (board?.waiting ?? []).map((t) => ({ value: t.ticket_id, label: `${t.ticket_no} (waiting${t.lane === 'PRIORITY' ? ', priority' : ''})`, called: false }));
  return [...called, ...waiting];
}

/** "12 min" / "0 min" for a measured wait, null when there was no ticket (never shown as 0). */
export function queueWaitText(minutes) {
  if (minutes === null || minutes === undefined || !Number.isFinite(Number(minutes))) return null;
  return `${Number(minutes)} min`;
}

/** A report/KPI bucket's queue wait: "8.5 min average (12 measured)", "Not measured" when nothing was, '-' for an older report. */
export function queueWaitFigure(bucket) {
  const q = bucket?.queue_wait;
  if (!q) return '-';
  if (!q.measured) return 'Not measured';
  return `${q.average_minutes} min average (${q.measured} measured)`;
}

const WINDOW_DESK_BY_CODE = Object.freeze({
  ACAD: 'Academic',
  REG: 'Registrar',
  ACCT: 'Cashier/Acct',
  ADMIN: 'Medical/Dental',
  ADM: 'Admissions',
  ADMREG: 'Admissions',
  OSAS: 'OSAS',
  OSFA: 'Scholarship',
  LIB: 'Library Desk',
});

const QUICK_NAME_BY_CODE = Object.freeze({
  ACAD: 'Academic Office',
  REG: "Registrar's Office",
  ACCT: 'Accounting Office',
  ADMIN: 'Administrative Office',
  ADM: 'Admission & Reg.',
  ADMREG: 'Admission & Reg.',
  OSAS: 'Student Affairs (OSAS)',
  OSFA: 'Scholarship (OSFA)',
  LIB: 'University Library',
});

/**
 * Extracts a compact uppercase office badge code (e.g. 'PUP-ACAD' -> 'ACAD', 'PUP-ADMREG' -> 'ADM').
 */
export function shortOfficeCode(officeCode = '', officeName = '') {
  const raw = String(officeCode ?? '').trim().toUpperCase();
  const stripped = raw.includes('-') ? raw.split('-').slice(1).join('-') : raw;
  if (stripped === 'ADMREG') return 'ADM';
  if (stripped) return stripped;
  const name = String(officeName ?? '').toLowerCase();
  if (name.includes('academic')) return 'ACAD';
  if (name.includes('registrar')) return 'REG';
  if (name.includes('accounting') || name.includes('cashier')) return 'ACCT';
  if (name.includes('administrative')) return 'ADMIN';
  if (name.includes('admission')) return 'ADM';
  if (name.includes('student affairs') || name.includes('osas')) return 'OSAS';
  if (name.includes('scholarship') || name.includes('osfa')) return 'OSFA';
  if (name.includes('library')) return 'LIB';
  return 'DESK';
}

/**
 * Compact office shortcut label for the Quick jump bar.
 */
export function shortOfficeName(officeName = '', officeCode = '') {
  const code = shortOfficeCode(officeCode, officeName);
  if (QUICK_NAME_BY_CODE[code]) return QUICK_NAME_BY_CODE[code];
  const clean = String(officeName ?? '').trim().replace(/^Campus\s+/i, '');
  return clean || code;
}

/**
 * Derives office counter metadata (shortCode, ticketPrefix, counterWindow, activeCounters, routingPolicy, ready)
 * from an office record and any configured counter records for that office.
 */
export function deriveOfficeCounterMeta(office, index = 0, counters = []) {
  if (!office) {
    return {
      shortCode: 'ACAD',
      ticketPrefix: 'ACAD-000',
      counterWindow: 'Window 1 · Academic',
      activeCounters: [],
      routingPolicy: 'Priority First',
      ready: true,
    };
  }
  const rawCode = String(office.office_code ?? '').trim().toUpperCase();
  const shortCode = shortOfficeCode(rawCode, office.office_name);
  const officeCounters = (Array.isArray(counters) ? counters : []).filter(
    (c) => String(c?.office_id ?? '') === String(office.office_id ?? '') && c?.is_active !== false,
  );
  const deskLabel = WINDOW_DESK_BY_CODE[shortCode] || shortOfficeName(office.office_name, rawCode);
  const defaultWindow = `Window ${index + 1} · ${deskLabel}`;
  const counterWindow = officeCounters.length > 0
    ? officeCounters[0].label
    : defaultWindow;

  return {
    shortCode,
    ticketPrefix: `${shortCode}-000`,
    counterWindow,
    activeCounters: officeCounters,
    routingPolicy: 'Priority First',
    ready: office.is_active !== false,
  };
}

/**
 * Builds an isolated client-side sample queue board for the selected office when the operator clicks
 * "Demo: Load Sample Queue". Never touches production APIs; "Reset Empty State" clears the preview.
 */
export function buildSampleQueueBoard(office, nowMs = Date.now()) {
  const shortCode = shortOfficeCode(office?.office_code, office?.office_name);
  const officeId = office?.office_id ?? 'demo-office';
  const nowIso = new Date(nowMs).toISOString();
  const queueDate = nowIso.slice(0, 10);
  const calledAtIso = new Date(nowMs - 4 * 60_000).toISOString();
  const skippableAtIso = new Date(nowMs - 60_000).toISOString();

  const called = [
    {
      ticket_id: `demo-called-${shortCode}-1`,
      ticket_no: `${shortCode}-002`,
      office_id: officeId,
      lane: 'PRIORITY',
      status: 'CALLED',
      queue_date: queueDate,
      issued_at: new Date(nowMs - 14 * 60_000).toISOString(),
      called_at: calledAtIso,
      skippable_at: skippableAtIso,
      can_skip: true,
      call_count: 1,
      skip_count: 0,
      version: 1,
      note: 'Senior Citizen · Credential Request',
    },
  ];

  const waiting = [
    {
      ticket_id: `demo-wait-${shortCode}-1`,
      ticket_no: `${shortCode}-004`,
      office_id: officeId,
      lane: 'PRIORITY',
      status: 'WAITING',
      queue_date: queueDate,
      issued_at: new Date(nowMs - 9 * 60_000).toISOString(),
      called_at: null,
      skippable_at: null,
      can_skip: false,
      call_count: 0,
      skip_count: 0,
      version: 1,
      note: 'PWD · Priority Lane Verification',
    },
    {
      ticket_id: `demo-wait-${shortCode}-2`,
      ticket_no: `${shortCode}-003`,
      office_id: officeId,
      lane: 'REGULAR',
      status: 'WAITING',
      queue_date: queueDate,
      issued_at: new Date(nowMs - 11 * 60_000).toISOString(),
      called_at: null,
      skippable_at: null,
      can_skip: false,
      call_count: 0,
      skip_count: 0,
      version: 1,
      note: 'Transcript / Enrollment Inquiry',
    },
    {
      ticket_id: `demo-wait-${shortCode}-3`,
      ticket_no: `${shortCode}-005`,
      office_id: officeId,
      lane: 'REGULAR',
      status: 'WAITING',
      queue_date: queueDate,
      issued_at: new Date(nowMs - 5 * 60_000).toISOString(),
      called_at: null,
      skippable_at: null,
      can_skip: false,
      call_count: 0,
      skip_count: 1,
      version: 2,
      note: 'Document Clearance',
    },
  ];

  const history = [
    {
      id: `demo-hist-${shortCode}-1`,
      ticket_id: `demo-served-${shortCode}-1`,
      ticket_no: `${shortCode}-001`,
      lane: 'REGULAR',
      action: 'SERVED',
      timestamp: new Date(nowMs - 18 * 60_000).toISOString(),
      note: 'Walk-in Verification Completed',
    },
    {
      id: `demo-hist-${shortCode}-2`,
      ticket_id: `demo-wait-${shortCode}-3`,
      ticket_no: `${shortCode}-005`,
      lane: 'REGULAR',
      action: 'SKIPPED',
      timestamp: new Date(nowMs - 6 * 60_000).toISOString(),
      note: 'No-show after 3-minute grace period',
    },
  ];

  return {
    board: {
      office_id: officeId,
      queue_date: queueDate,
      now: nowIso,
      grace_seconds: 180,
      called,
      waiting,
      counts: {
        waiting: waiting.length,
        waiting_priority: waiting.filter((t) => t.lane === 'PRIORITY').length,
        called: called.length,
        served: 1,
      },
      queue_empty: false,
    },
    history,
  };
}
