import { getDb } from '../lib/data-source.js';
import { dispatchSyncLogs } from '../lib/calendar/sync-dispatch.js';
import { SNAPSHOT_ENTITY_TYPE } from '../lib/calendar/sms-snapshot.js';

/** SMS's calendar push route. A bare address (no path) gets the route added; an address with a path is used as given. */
export const SMS_PUSH_PATH = '/api/v1/calendar/sync';
export function smsPushUrl(base) {
  try {
    const url = new URL(base);
    if (url.pathname === '/' || url.pathname === '') return `${url.origin}${SMS_PUSH_PATH}`;
  } catch { /* not a URL: used as given and the push fails with a clear error */ }
  return base;
}

/** Sync settings from the environment (retry interval and attempts are team-set). */
export function syncSettings(env = process.env) {
  const number = (name, fallback) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  // AUDIT is the legacy queue name for SMS, including already queued messages.
  const smsBase = env.SMS_URL?.trim() || env.AUDIT_URL?.trim();
  const urls = { FMS: env.FMS_URL?.trim(), AUDIT: smsBase ? smsPushUrl(smsBase) : undefined };
  const receiverTokens = { FMS: env.FMS_CALENDAR_TOKEN?.trim(), AUDIT: (env.SMS_SERVICE_TOKEN || env.SMS_CALENDAR_TOKEN)?.trim() };
  const candidates = String(env.SMS_SYNC_ENABLED ?? '').toLowerCase() === 'true' ? ['FMS', 'AUDIT'] : ['FMS'];
  return {
    urls,
    receiverTokens,
    retryIntervalMs: number('SYNC_RETRY_INTERVAL_SECONDS', 60) * 1000,
    maxAttempts: Math.floor(number('SYNC_MAX_ATTEMPTS', 20)),
    timeoutMs: number('SYNC_TIMEOUT_SECONDS', 5) * 1000,
    // EB16: SMS (the AUDIT queue) is a receiver with its own switch, OFF by default: nothing leaves CCMS for SMS until
    // SMS_SYNC_ENABLED=true. Unconfigured receivers also leave their rows waiting.
    // The SMS ingest route understands term snapshots only. Entry messages, term events and working hours are not sent to it:
    // SMS gets a new snapshot whenever an entry changes, and it does not need office hours. Set SMS_SEND_ALL_MESSAGES=true only
    // for a receiver (such as the mock) that accepts every message.
    onlySmsEntityTypes: String(env.SMS_SEND_ALL_MESSAGES ?? '').toLowerCase() === 'true' ? null : [SNAPSHOT_ENTITY_TYPE],
    enabledConsumers: candidates.filter((consumer) => urls[consumer] && receiverTokens[consumer]),
  };
}

/**
 * Pushes due SyncLog rows (calendar and term changes) to FMS and Audit, and retries failed ones.
 * Run by the Vercel Cron route (/api/jobs/calendar-sync) and right after a change commits.
 */
export async function runCalendarSync({ env = process.env, ...overrides } = {}) {
  const settings = syncSettings(env);
  if (!settings.enabledConsumers.length) {
    return { skipped: true, reason: 'No enabled calendar receiver has a URL and Bearer token', sent: 0, failed: 0 };
  }
  return { skipped: false, ...(await dispatchSyncLogs(await getDb(), { ...settings, ...overrides })) };
}
