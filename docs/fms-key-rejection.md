# TT6 — Stop FMS retries after a rejected key

Implementation status: **verified with local mock receivers and a disposable PostgreSQL database**, as recorded in [tt5-tt6-release-checks.md](tt5-tt6-release-checks.md). Live FMS integration has not been exercised.

Core's `dispatchSyncLogs` now applies the existing SCMS/SMS 401 rule to the FMS consumer. The first HTTP 401 stores a fixed `KEY_REJECTED:` reason and exhausts the row's retry budget, preventing the dispatcher from selecting it again under the existing retry policy. No receiver response text or credentials are stored in that reason. Other failures retain the existing bounded retry interval and maximum-attempt policy.

This uses the existing schema and SCMS convention: database status stays `FAILED`, and `attempts` is set to the configured maximum as the terminal marker. That counter is not the number of actual network attempts for a rejected key. The API exposes safe `error_code: "KEY_REJECTED"`; the Sync activity UI shows **Key refused** and stops saying automatic retries will continue.

After the operator has corrected the configured receiver key, a Super Admin can use **Retry after key update** in Sync activity. This calls `POST /api/calendar/sync/<sync_id>/requeue` through the gateway (Core's own path is `/api/sync/<sync_id>/requeue`). Core locks the row and accepts only a failed FMS or SCMS/SMS row carrying `KEY_REJECTED`. It keeps the same sync ID and payload, clears the error, resets attempts to zero and makes the row due again. Other rows return a conflict. Non-Super Admin callers are refused by the route and domain operation.

Requeue records a `SYNC_REQUEUED` audit event with safe status/consumer metadata and schedules the existing dispatch mechanism. It does not rotate keys, bypass receiver authentication or assume the new key works. Requeue only after the new key is configured in the actual running Core environment. A later 401 stops that row again.

The local regression tests verify one HTTP attempt after a 401, no subsequent automatic retry, safe status output, audited requeue with the same payload, authorization checks, bounded retries for other failures and the existing SCMS/SMS rule. TT5's standalone mock receiver also supports configured 401 responses and attempt counters for future hosted QA. No success against a live FMS is claimed.
