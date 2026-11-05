import { getDb } from '../lib/data-source.js';
import { dispatchSyncLogs } from '../lib/calendar/sync-dispatch.js';

/** Sync settings from the environment (retry interval and attempts are team-set). */
export function syncSettings(env = process.env) {
  const number = (name, fallback) => {
    const value = Number(env[name]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  };
  // AUDIT is the legacy queue name for SMS, including already queued messages.
  const urls = { FMS: env.FMS_URL?.trim(), AUDIT: env.SMS_URL?.trim() || env.AUDIT_URL?.trim() };
  const receiverTokens = { FMS: env.FMS_CALENDAR_TOKEN?.trim(), AUDIT: env.SMS_CALENDAR_TOKEN?.trim() };
  const candidates = String(env.SMS_SYNC_ENABLED ?? '').toLowerCase() === 'true' ? ['FMS', 'AUDIT'] : ['FMS'];
  return {
    urls,
    receiverTokens,
    retryIntervalMs: number('SYNC_RETRY_INTERVAL_SECONDS', 60) * 1000,
    maxAttempts: Math.floor(number('SYNC_MAX_ATTEMPTS', 20)),
    timeoutMs: number('SYNC_TIMEOUT_SECONDS', 5) * 1000,
    // EB16: SMS (the AUDIT queue) is a receiver with its own switch, OFF by default: nothing leaves CCMS for SMS until
    // SMS_SYNC_ENABLED=true. Unconfigured receivers also leave their rows waiting.
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
