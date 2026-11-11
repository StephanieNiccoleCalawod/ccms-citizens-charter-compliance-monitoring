import { Errors, ROLES, isUuid, recordAudit } from 'ccms-shared';
import { newId } from './calendar-rules.js';
import { SyncLog } from '../entities/index.js';
import { enqueueAffectedSnapshots } from './sms-snapshot.js';
import { CHANGE_KIND, buildFmsMessage, buildMessage, calendarWindow, entityIdOf, fmsTarget, inFmsTerm, occurrenceDates } from './message.js';
import { kickOutbox, kickSync } from '../outbox.js';

export const CONSUMERS = Object.freeze(['FMS', 'AUDIT']);

/**
 * Queues one outward push per consumer for a change. Call it inside the same transaction as the
 * change so the rows exist if and only if the change committed. Sending happens later (and never
 * blocks or undoes the save). FMS receives calendar data; Audit receives calendar and term data.
 */
export async function enqueueSync(manager, { eventType, entityType, entityId, data, consumers = CONSUMERS }) {
  const occurredAt = new Date().toISOString();
  const repo = manager.getRepository(SyncLog);
  for (const consumerSystem of consumers) {
    const syncId = newId();
    await repo.insert({
      syncId,
      consumerSystem,
      eventType,
      entityType,
      entityId: entityId == null ? null : String(entityId),
      payload: {
        sync_id: syncId,
        consumer_system: consumerSystem,
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId == null ? null : String(entityId),
        occurred_at: occurredAt,
        data,
      },
      status: 'PENDING',
    });
  }
}

/**
 * Queues the cal-1.0 messages for one calendar-entry change (EB3). Call it inside the same transaction as the change.
 *   entry      the entry after the change (for a removal: the entry as it was, with its raised revision)
 *   previous   the entry before an update (null for an add or a removal)
 *   removed    true for a removal (the row is kept as a tombstone and REMOVE is sent)
 * One message per dated entry: a recurring entry gives one per date inside the calendar window. Dates that an edit
 * made disappear get a REMOVE. Each message is its own sync row; its messageId is that row's ID, and a retry sends
 * the stored payload again, so the messageId never changes. FMS gets schema 3 (buildFmsMessage), only for dates inside
 * its term and only once FMS_TERM_ID is set; the SMS queue (AUDIT) gets cal-1.0.
 */
export async function enqueueCalendarChange(manager, { eventType, entry, previous = null, removed = false, consumers = CONSUMERS, env = process.env }) {
  const window = calendarWindow(env);
  const target = fmsTarget(env);
  const sourceTimestamp = new Date();
  const repo = manager.getRepository(SyncLog);
  const withRevision = (value) => ({ ...value, revision: entry.revision });

  for (const consumerSystem of consumers) {
    const fms = consumerSystem === 'FMS';
    if (fms && !target) continue;
    const accepts = (date) => !fms || inFmsTerm(target, date);
    const planned = []; // { value, date, changeKind }
    if (removed) {
      for (const date of occurrenceDates(entry, window)) if (accepts(date)) planned.push({ value: entry, date, changeKind: CHANGE_KIND.REMOVE });
    } else {
      const now = new Set();
      for (const date of occurrenceDates(entry, window)) {
        now.add(entityIdOf(entry, date));
        if (accepts(date)) planned.push({ value: entry, date, changeKind: CHANGE_KIND.UPSERT });
      }
      // What an earlier version sent and this version no longer has (a moved date, or a recurring entry that changed
      // shape) is withdrawn.
      if (previous) {
        for (const date of occurrenceDates(previous, window)) {
          if (!now.has(entityIdOf(previous, date)) && accepts(date)) planned.push({ value: withRevision(previous), date, changeKind: CHANGE_KIND.REMOVE });
        }
      }
    }
    for (const { value, date, changeKind } of planned) {
      const syncId = newId();
      const payload = fms
        ? buildFmsMessage({ messageId: syncId, entry: value, date, changeKind, target, sourceTimestamp })
        : buildMessage({ messageId: syncId, entry: value, date, changeKind });
      await repo.insert({
        syncId,
        consumerSystem,
        eventType,
        entityType: 'calendar_exception',
        entityId: payload.entityId,
        payload,
        status: 'PENDING',
      });
    }
  }
  // EB17: SMS also gets a fresh term snapshot (it recalculates its deadlines from the whole term).
  if (consumers.includes('AUDIT')) await enqueueAffectedSnapshots(manager, { entry, previous });
}

const iso = (value) => (value ? new Date(value).toISOString() : null);

export function toSyncItem(row) {
  return {
    sync_id: row.syncId,
    consumer_system: row.consumerSystem,
    event_type: row.eventType,
    status: row.status,
    last_synced_at: iso(row.lastSyncedAt),
    attempts: row.attempts,
    ...(String(row.lastError ?? '').startsWith('KEY_REJECTED:') ? { error_code: 'KEY_REJECTED' } : {}),
  };
}

/** GET /sync/status: when Audit last synced, the last FMS push, and the most recent rows. */
export async function getSyncStatus(dataSource, { limit = 20 } = {}) {
  const repo = dataSource.getRepository(SyncLog);
  const lastAudit = await repo
    .createQueryBuilder('s')
    .where("s.consumerSystem = 'AUDIT' AND s.status = 'ACKNOWLEDGED' AND s.lastSyncedAt IS NOT NULL")
    .orderBy('s.lastSyncedAt', 'DESC')
    .getOne();
  const lastFms = await repo
    .createQueryBuilder('s')
    .where("s.consumerSystem = 'FMS'")
    .orderBy('s.createdAt', 'DESC')
    .addOrderBy('s.syncId', 'DESC')
    .getOne();
  const recent = await repo
    .createQueryBuilder('s')
    .orderBy('s.createdAt', 'DESC')
    .addOrderBy('s.consumerSystem', 'ASC')
    .limit(limit)
    .getMany();
  // The Syllabus Management System (SMS, queue AUDIT) answers in the push reply, so a success leaves the row SENT (it is never
  // ACKNOWLEDGED by a separate call). sms_last_received is the last time SMS accepted data; sms_issue is set while the newest
  // failed push is more recent than that. Only a fixed state is exposed, never the stored error text.
  const lastSms = await repo
    .createQueryBuilder('s')
    .where("s.consumerSystem = 'AUDIT' AND s.status IN ('SENT', 'ACKNOWLEDGED') AND s.lastSyncedAt IS NOT NULL")
    .orderBy('s.lastSyncedAt', 'DESC')
    .getOne();
  const failedSms = await repo
    .createQueryBuilder('s')
    .where("s.consumerSystem = 'AUDIT' AND s.status = 'FAILED'")
    .orderBy('s.createdAt', 'DESC')
    .getOne();
  const failedStillOpen = failedSms && (!lastSms?.lastSyncedAt || (failedSms.lastAttemptAt ?? failedSms.createdAt) > lastSms.lastSyncedAt);
  return {
    audit_last_synced: iso(lastAudit?.lastSyncedAt),
    fms_last_push: lastFms ? { status: lastFms.status, at: iso(lastFms.lastAttemptAt ?? lastFms.createdAt),
      ...(String(lastFms.lastError ?? '').startsWith('KEY_REJECTED:') ? { error_code: 'KEY_REJECTED' } : {}) } : null,
    sms_last_received: iso(lastSms?.lastSyncedAt),
    sms_issue: failedStillOpen
      ? { state: String(failedSms.lastError ?? '').startsWith('KEY_REJECTED') ? 'KEY_REJECTED' : 'FAILED', at: iso(failedSms.lastAttemptAt ?? failedSms.createdAt) }
      : null,
    recent: recent.map(toSyncItem),
  };
}

/** TT6: explicit recovery only; preserve the sync ID and payload and audit the retry decision without credentials. */
export async function requeueRejectedSync(dataSource, actor, syncId, { ipAddress } = {}) {
  if (actor.role !== ROLES.SUPER_ADMIN) throw Errors.forbidden();
  if (!isUuid(syncId)) throw Errors.notFound('Unknown sync ID', 'SYNC_NOT_FOUND');
  const result = await dataSource.transaction(async (manager) => {
    const repo = manager.getRepository(SyncLog);
    const row = await repo.findOne({ where: { syncId }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw Errors.notFound('Unknown sync ID', 'SYNC_NOT_FOUND');
    if (row.status !== 'FAILED' || !String(row.lastError ?? '').startsWith('KEY_REJECTED:') || !CONSUMERS.includes(row.consumerSystem)) {
      throw Errors.conflict('Only a sync row stopped by a rejected key can be requeued here', 'SYNC_NOT_KEY_REJECTED');
    }
    const before = { status: row.status, attempts: row.attempts, error_code: 'KEY_REJECTED' };
    row.status = 'PENDING';
    row.attempts = 0;
    row.lastError = null;
    row.nextAttemptAt = new Date();
    await repo.save(row);
    await recordAudit(manager, { actor, action: 'SYNC_REQUEUED', entityType: 'sync_log', entityId: row.syncId,
      before, after: { status: 'PENDING', attempts: 0, consumer_system: row.consumerSystem }, ipAddress });
    return toSyncItem(row);
  });
  kickOutbox();
  kickSync();
  return result;
}

/** POST /sync/ack: Audit confirms it received a push. Only Audit rows can be acknowledged. */
export async function acknowledgeSync(dataSource, syncId) {
  if (!isUuid(syncId)) throw Errors.notFound('Unknown sync ID', 'SYNC_NOT_FOUND');
  return dataSource.transaction(async (manager) => {
    const row = await manager.getRepository(SyncLog).findOne({ where: { syncId }, lock: { mode: 'pessimistic_write' } });
    if (!row) throw Errors.notFound('Unknown sync ID', 'SYNC_NOT_FOUND');
    if (row.consumerSystem !== 'AUDIT') {
      throw Errors.conflict('Only pushes to Audit can be acknowledged', 'SYNC_NOT_ACKNOWLEDGEABLE');
    }
    if (row.status !== 'ACKNOWLEDGED') {
      row.status = 'ACKNOWLEDGED';
      row.lastSyncedAt = new Date();
      row.lastError = null;
      await manager.getRepository(SyncLog).save(row);
    }
    return { sync_id: row.syncId, status: row.status, last_synced_at: iso(row.lastSyncedAt) };
  });
}
