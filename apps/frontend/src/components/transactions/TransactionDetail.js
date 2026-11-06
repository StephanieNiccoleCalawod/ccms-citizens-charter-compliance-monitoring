'use client';

import { notify } from '../../lib/ui/notify.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import StatusBanner from '../feedback/StatusBanner.js';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import Modal from '../modals/Modal.js';
import StatusBadge from '../ui/StatusBadge.js';
import { getSettings } from '../../lib/api/operations.js';
import { cancelTransaction, completeTransaction, getTransaction, holdTransaction, resumeTransaction } from '../../lib/api/transactions.js';
import { formatDateTime } from '../../lib/ui/date-format.js';
import { COMPLETE_MESSAGES, COMPLIANCE_LABELS, canComplete, complianceState, completeErrorResult, describeElapsed, describeVariance, mustResumeFirst, reconcileBanner } from '../../lib/ui/complete-transaction.js';
import { EMPTY_MANUAL_END, completionBody, manualEndErrors } from '../../lib/ui/backdate.js';
import { CANCEL_MESSAGES, CANCEL_REASON_MAX, cancelErrorResult, cancelReconcileBanner, canCancel, validateCancelReason } from '../../lib/ui/cancel-transaction.js';
import { HOLD_REASON_MAX, canHold, canResume, formatHeldMinutes, holdActionError, loadErrorResult, validateHoldReason } from '../../lib/ui/hold-transaction.js';
import { clientTypeLabel, formatStandardDuration, statusLabel } from '../../lib/ui/start-transaction.js';
import ElapsedTime from '../ui/ElapsedTime.js';
import { officeName } from '../../lib/ui/names.js';

const LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500';
const VALUE = 'text-sm text-slate-800';

const Item = ({ label, children, testId }) => (
  <div>
    <dt className={LABEL}>{label}</dt>
    <dd className={VALUE} data-testid={testId}>{children}</dd>
  </div>
);

/**
 * One transaction with its actions (hold, resume, complete, cancel). Shown on its own page (backHref) and inside the Transactions
 * modal (embedded). `onChanged` is called when a re-read shows the transaction differs from what was first shown, so a list behind
 * it can refresh; `onBusyChange(true)` tells a wrapper an action is running, so it can refuse to close.
 */
export default function TransactionDetail({ id, role, backHref, embedded = false, onChanged, onBusyChange }) {
  const [tx, setTx] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [holdEnabled, setHoldEnabled] = useState(false); // stays false (Hold hidden) until the server says otherwise
  const [banner, setBanner] = useState(null); // { variant, message }
  const [busy, setBusy] = useState(null); // 'hold' | 'resume' | null
  const [dialog, setDialog] = useState(false);
  const [completeDialog, setCompleteDialog] = useState(false);
  const [manualEnd, setManualEnd] = useState({ ...EMPTY_MANUAL_END }); // Enter end time manually: what the person typed (Manila time)
  const [manualErrors, setManualErrors] = useState({});
  const [outcomeUnknown, setOutcomeUnknown] = useState(false); // a completion may or may not have been applied: read it back before any new attempt
  const [cancelDialog, setCancelDialog] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelTouched, setCancelTouched] = useState(false);
  const [cancelServerError, setCancelServerError] = useState(null);
  const unknownAction = useRef('complete'); // which attempt left the outcome unclear, so the check words its answer right
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverReasonError, setServerReasonError] = useState(null);
  const busyRef = useRef(false); // set synchronously, so a double click cannot send two requests
  const holdButtonRef = useRef(null);
  const completeButtonRef = useRef(null);
  const cancelButtonRef = useRef(null);

  // The result of an action: success and failure are the app-wide toast (said once, after the server answered); a warning or an
  // "outcome unclear" note that needs reading stays as a banner in the page.
  function report(next) {
    if (next?.variant === 'success') notify.success(next.message);
    else if (next?.variant === 'error') notify.error(next.message);
    else setBanner(next);
  }

  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings();
      setHoldEnabled(settings?.hold_enabled === true);
    } catch {
      setHoldEnabled(false); // unknown: keep Hold hidden. Resume does not depend on it.
    }
  }, []);

  const loadTransaction = useCallback(async () => {
    try {
      const data = await getTransaction(id);
      setTx(data);
      setLoadError(null);
      return data;
    } catch (err) {
      const result = loadErrorResult(err);
      setLoadError(result);
      // The service refused (or lost) the transaction: show none of it. A network or server failure keeps what was read, marked as possibly out of date.
      if (result.kind === 'auth' || result.kind === 'forbidden' || result.kind === 'notfound') setTx(null);
      return null;
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the server's current answers once for this transaction
    loadSettings();
    loadTransaction();
  }, [loadSettings, loadTransaction]);

  // Embedded (modal): tell the list behind it when a re-read shows this transaction is no longer what was first shown
  // (completed, cancelled, held or resumed here), and tell the wrapper while an action runs so the modal is not closed under it.
  const firstSeen = useRef(null);
  useEffect(() => {
    if (!tx) return;
    const before = firstSeen.current;
    firstSeen.current = { version: tx.version, status: tx.status };
    if (before && (before.version !== tx.version || before.status !== tx.status)) onChanged?.();
  }, [tx, onChanged]);
  useEffect(() => {
    onBusyChange?.(busy !== null);
  }, [busy, onBusyChange]);

  const reasonCheck = validateHoldReason(reason);
  const reasonMessage = serverReasonError ?? (touched ? reasonCheck.error : null);

  function openDialog() {
    setBanner(null);
    setReason('');
    setTouched(false);
    setServerReasonError(null);
    setDialog(true);
  }

  async function afterFailure(failure) {
    if (failure.reload) {
      await loadTransaction();
      await loadSettings();
    }
  }

  async function confirmHold(event) {
    event?.preventDefault();
    if (busyRef.current) return;
    setTouched(true);
    if (reasonCheck.error) return;
    busyRef.current = true;
    setBusy('hold');
    setServerReasonError(null);
    try {
      await holdTransaction(id, reasonCheck.reason);
      setDialog(false);
      const fresh = await loadTransaction();
      report({ variant: 'success', message: fresh ? `The transaction is now ${statusLabel(fresh.status).toLowerCase()}.` : 'The transaction has been put on hold. Reload to see its details.' });
    } catch (err) {
      const failure = holdActionError(err, 'hold');
      if (failure.fieldError) setServerReasonError(failure.fieldError);
      else {
        setDialog(false);
        report({ variant: 'error', message: failure.message });
        await afterFailure(failure);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function confirmResume() {
    if (busyRef.current || !canResume(tx)) return;
    busyRef.current = true;
    setBusy('resume');
    setBanner(null);
    try {
      await resumeTransaction(id);
      const fresh = await loadTransaction();
      report({ variant: 'success', message: fresh ? `The transaction is back to ${statusLabel(fresh.status).toLowerCase()}. Time on hold: ${formatHeldMinutes(fresh.held_minutes)} (working time).` : 'The transaction has been resumed. Reload to see its details.' });
    } catch (err) {
      const failure = holdActionError(err, 'resume');
      report({ variant: 'error', message: failure.message });
      await afterFailure(failure); // on Core down the transaction stays exactly as the server has it: on hold
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  function openCompleteDialog() {
    setBanner(null);
    setManualEnd({ ...EMPTY_MANUAL_END });
    setManualErrors({});
    setCompleteDialog(true);
  }

  async function confirmComplete() {
    if (busyRef.current || !canComplete(tx)) return;
    // Early feedback only; the service checks the end against the stored start and its own clock again.
    const early = manualEndErrors(manualEnd, tx.started_at, Date.now());
    if (Object.keys(early).length) {
      setManualErrors(early);
      return;
    }
    setManualErrors({});
    busyRef.current = true;
    setBusy('complete');
    setBanner(null);
    try {
      unknownAction.current = 'complete';
      await completeTransaction(id, undefined, completionBody(manualEnd));
      setCompleteDialog(false);
      setOutcomeUnknown(false);
      const fresh = await loadTransaction(); // the server's answer is read back; nothing is shown before it confirms
      // The server confirmed, but if reading it back fails the page still shows the old state: withdraw Complete until it is checked.
      if (!fresh) setOutcomeUnknown(true);
      report(fresh ? { variant: 'success', message: complianceState(fresh) === 'pending' ? COMPLETE_MESSAGES.pendingNote : 'The transaction has been completed.' } : { variant: 'warning', message: COMPLETE_MESSAGES.unknownStillUnclear });
    } catch (err) {
      const failure = completeErrorResult(err);
      if (manualEnd.enabled && failure.kind === 'validation' && Object.keys(failure.fieldErrors ?? {}).length) {
        setManualErrors(failure.fieldErrors); // the dialog stays open on the fields the service named; nothing was saved
        return;
      }
      setCompleteDialog(false);
      report({ variant: 'error', message: failure.message });
      if (failure.unknown) setOutcomeUnknown(true);
      if (failure.reload) {
        const fresh = await loadTransaction();
        if (!fresh) setOutcomeUnknown(true); // the state could not be read back: no new attempt from stale data
        if (failure.unknown) {
          if (!fresh) report({ variant: 'warning', message: COMPLETE_MESSAGES.unknownStillUnclear });
          else {
            setOutcomeUnknown(false);
            report(reconcileBanner(fresh.status));
          }
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  const cancelCheck = validateCancelReason(cancelReason);
  const cancelMessage = cancelServerError ?? (cancelTouched ? cancelCheck.error : null);

  function openCancelDialog() {
    setBanner(null);
    setCancelReason('');
    setCancelTouched(false);
    setCancelServerError(null);
    setCancelDialog(true);
  }

  async function confirmCancel(event) {
    event?.preventDefault();
    if (busyRef.current || !canCancel(tx, role)) return; // eligibility is re-checked against the last state read from the server
    setCancelTouched(true);
    if (cancelCheck.error) return;
    busyRef.current = true;
    setBusy('cancel');
    setCancelServerError(null);
    try {
      await cancelTransaction(id, cancelCheck.reason);
      setCancelDialog(false);
      setOutcomeUnknown(false);
      const fresh = await loadTransaction(); // shown only from the server's own answer
      if (!fresh) {
        unknownAction.current = 'cancel';
        setOutcomeUnknown(true); // the server confirmed, but the page still shows the old state: withdraw every action until it is checked
      }
      report(fresh ? { variant: fresh.status === 'CANCELLED' ? 'success' : 'info', message: fresh.status === 'CANCELLED' ? CANCEL_MESSAGES.success : cancelReconcileBanner(fresh.status).message } : { variant: 'warning', message: COMPLETE_MESSAGES.unknownStillUnclear });
    } catch (err) {
      const failure = cancelErrorResult(err);
      if (failure.fieldError) {
        setCancelServerError(failure.fieldError);
      } else {
        setCancelDialog(false);
        report({ variant: 'error', message: failure.message });
        if (failure.unknown) { unknownAction.current = 'cancel'; setOutcomeUnknown(true); }
        if (failure.reload) {
          const fresh = await loadTransaction();
          if (!fresh) {
            unknownAction.current = 'cancel';
            setOutcomeUnknown(true); // the state could not be read back: no new attempt from stale data
            if (failure.unknown) report({ variant: 'warning', message: COMPLETE_MESSAGES.unknownStillUnclear });
          } else if (failure.unknown) {
            setOutcomeUnknown(false);
            report(cancelReconcileBanner(fresh.status));
          }
        }
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  async function checkStatus() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy('refresh');
    try {
      const fresh = await loadTransaction();
      if (fresh) {
        if (outcomeUnknown) {
          setOutcomeUnknown(false);
          report(unknownAction.current === 'cancel' ? cancelReconcileBanner(fresh.status) : reconcileBanner(fresh.status));
        } else setBanner(null);
      }
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  if (loadError && !tx) {
    return (
      <div className="space-y-4">
        <StatusBanner variant="error" message={loadError.message} />
        <div className="flex gap-3">
          {loadError.kind === 'network' || loadError.kind === 'server' ? (
            <button type="button" className="btn-secondary" onClick={loadTransaction}>Try again</button>
          ) : null}
          {embedded ? null : <Link href={backHref} className="btn-secondary">Back to transactions</Link>}
          {embedded ? null : <Link href="/transactions/new" className="btn-secondary">Start a transaction</Link>}
        </div>
      </div>
    );
  }
  if (!tx) return <p className="text-sm text-slate-600" role="status">Loading the transaction…</p>;

  const onHold = canResume(tx);
  const compliance = complianceState(tx);
  return (
    <div className="space-y-4">
      {embedded ? null : <Link href={backHref} className="inline-block text-sm font-semibold text-maroon-800 underline-offset-2 hover:underline">&larr; Back to transactions</Link>}
      {banner ? <StatusBanner variant={banner.variant} message={banner.message} onDismiss={() => setBanner(null)} /> : null}
      {loadError ? <StatusBanner variant="warning" message={`${loadError.message} The details below may be out of date.`} /> : null}
      <section className={embedded ? '' : 'card p-6'} aria-labelledby="tx-heading">
        <h2 id="tx-heading" className="text-lg">Tracking number</h2>
        <p className="mt-1 font-mono text-2xl font-semibold text-slate-900" data-testid="tracking-no">{tx.tracking_no}</p>
        <p className="mt-1 text-sm text-slate-600">
          Status: <span className="font-semibold text-slate-900" data-testid="status">{statusLabel(tx.status)}</span>
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <Item label="Service">{tx.service_name}</Item>
          <Item label="Office">{officeName(tx)}</Item>
          <Item label="Standard saved with it">{formatStandardDuration({ duration_days: tx.standard_duration_days, duration_hours: tx.standard_duration_hours, duration_minutes: tx.standard_duration_minutes })}</Item>
          <Item label="Started">{formatDateTime(tx.started_at) || '-'} (Asia/Manila)</Item>
          <Item label="Elapsed time"><ElapsedTime transaction={tx} /></Item>
          <Item label="Client type">{clientTypeLabel(tx.client_type)}</Item>
          {tx.counter_label ? <Item label="Counter">{tx.counter_label}</Item> : null}
          <Item label="Time on hold so far (working time)" testId="held-minutes">{formatHeldMinutes(tx.held_minutes)}</Item>
          {tx.ended_at ? <Item label="Ended" testId="ended-at">{formatDateTime(tx.ended_at) || '-'} (Asia/Manila)</Item> : null}
          {onHold ? <Item label="Pending since" testId="hold-started">{formatDateTime(tx.hold_started_at) || '-'} (Asia/Manila)</Item> : null}
          {tx.is_backdated === true ? <Item label="Entered after the fact" testId="backdated">Yes{tx.backdate_reason ? <span className="block whitespace-pre-line text-xs text-slate-600" data-testid="backdate-reason">{tx.backdate_reason}</span> : null}</Item> : null}
          {tx.status === 'CANCELLED' && tx.cancel_reason ? <Item label="Reason for cancelling" testId="cancel-reason">{tx.cancel_reason}</Item> : null}
          {onHold && tx.hold_reason ? <Item label="Reason for the hold" testId="hold-reason">{tx.hold_reason}</Item> : null}
        </dl>
        {compliance !== 'none' ? (
          <div className="mt-6 border-t border-line pt-4" data-testid="compliance">
            <h3 className="text-sm font-semibold text-slate-700">Compliance</h3>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <StatusBadge variant={compliance}><span data-testid="compliance-label">{COMPLIANCE_LABELS[compliance]}</span></StatusBadge>
              {compliance === 'pending' ? (
                <button type="button" className="btn-secondary" onClick={checkStatus} disabled={busy !== null}>Refresh result</button>
              ) : null}
            </div>
            {compliance !== 'pending' ? (
              <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                {describeElapsed(tx.elapsed_working_minutes) ? <Item label="Elapsed working time" testId="elapsed">{describeElapsed(tx.elapsed_working_minutes)}</Item> : null}
                {describeVariance(tx.variance_minutes) ? <Item label="Compared with the standard (working time)" testId="variance">{describeVariance(tx.variance_minutes)}</Item> : null}
              </dl>
            ) : <p className="mt-2 text-sm text-slate-600">The result has not been computed yet.</p>}
          </div>
        ) : null}
        {mustResumeFirst(tx) ? <p className="mt-4 text-sm text-slate-600" data-testid="resume-first">{COMPLETE_MESSAGES.onHold}</p> : null}
        {outcomeUnknown ? (
          <div className="mt-4"><button type="button" className="btn-secondary" onClick={checkStatus} disabled={busy !== null}>Check status</button></div>
        ) : null}
        {!outcomeUnknown && (canHold(tx, holdEnabled) || onHold || canComplete(tx) || canCancel(tx, role)) ? (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {canComplete(tx) ? (
              <button ref={completeButtonRef} type="button" className="btn-primary" onClick={openCompleteDialog} disabled={busy !== null}>
                Complete Transaction
              </button>
            ) : null}
            {onHold ? (
              <button type="button" className="btn-primary" onClick={confirmResume} disabled={busy !== null} aria-busy={busy === 'resume' || undefined}>
                {busy === 'resume' ? 'Resuming…' : banner?.variant === 'error' ? 'Try resuming again' : 'Resume'}
              </button>
            ) : canHold(tx, holdEnabled) ? (
              <button ref={holdButtonRef} type="button" className="btn-secondary" onClick={openDialog} disabled={busy !== null}>
                Hold
              </button>
            ) : null}
            {canCancel(tx, role) ? (
              <button ref={cancelButtonRef} type="button" className="btn-danger" onClick={openCancelDialog} disabled={busy !== null}>
                Cancel Transaction
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      <ConfirmDialog
        open={completeDialog}
        title={COMPLETE_MESSAGES.confirmTitle}
        message={COMPLETE_MESSAGES.confirm}
        confirmLabel="Confirm"
        busy={busy === 'complete'}
        busyLabel="Completing…"
        onConfirm={confirmComplete}
        onCancel={() => setCompleteDialog(false)}
        returnFocusRef={completeButtonRef}
      >
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-800">
            <input id="complete-manual-end" type="checkbox" className="h-4 w-4 rounded border-slate-300 accent-[#800000]" checked={manualEnd.enabled} disabled={busy === 'complete'} onChange={(e) => { setManualEnd({ ...EMPTY_MANUAL_END, enabled: e.target.checked }); setManualErrors({}); }} />
            Enter end time manually
          </label>
          {manualEnd.enabled ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">Use this when the work finished earlier and is being recorded now. Times are Manila time (Asia/Manila). The end must be after the start ({formatDateTime(tx.started_at) || '-'}) and not in the future.</p>
              <div>
                <label className="label" htmlFor="complete-end">Ended (Manila time)</label>
                <input id="complete-end" type="datetime-local" className="input" value={manualEnd.ended_at} disabled={busy === 'complete'} onChange={(e) => { setManualEnd((m) => ({ ...m, ended_at: e.target.value })); setManualErrors((x) => ({ ...x, ended_at: undefined })); }} aria-invalid={manualErrors.ended_at ? true : undefined} aria-describedby={manualErrors.ended_at ? 'complete-end-error' : undefined} />
                {manualErrors.ended_at ? <p id="complete-end-error" className="mt-1 text-xs text-red-700">{manualErrors.ended_at}</p> : null}
              </div>
              <div>
                <label className="label" htmlFor="complete-end-reason">Why is the end time entered by hand?</label>
                <textarea id="complete-end-reason" className="input min-h-20" value={manualEnd.reason} maxLength={500} disabled={busy === 'complete'} onChange={(e) => { setManualEnd((m) => ({ ...m, reason: e.target.value })); setManualErrors((x) => ({ ...x, backdate_reason: undefined })); }} aria-invalid={manualErrors.backdate_reason ? true : undefined} aria-describedby={manualErrors.backdate_reason ? 'complete-end-reason-error' : undefined} />
                {manualErrors.backdate_reason ? <p id="complete-end-reason-error" className="mt-1 text-xs text-red-700">{manualErrors.backdate_reason}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </ConfirmDialog>

      <Modal
        open={cancelDialog}
        title={CANCEL_MESSAGES.title}
        onClose={busy ? undefined : () => setCancelDialog(false)}
        returnFocusRef={cancelButtonRef}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCancelDialog(false)} disabled={busy !== null}>Keep transaction</button>
            <button type="submit" form="cancel-form" className="btn-danger" disabled={busy !== null || Boolean(cancelCheck.error)} aria-busy={busy === 'cancel' || undefined}>
              {busy === 'cancel' ? 'Cancelling…' : 'Cancel transaction'}
            </button>
          </>
        }
      >
        <form id="cancel-form" onSubmit={confirmCancel} noValidate>
          <p className="mb-3 text-sm text-slate-600">{CANCEL_MESSAGES.warning}</p>
          <label htmlFor="cancel-reason-input" className="label">Reason</label>
          <textarea
            id="cancel-reason-input"
            className="input min-h-24"
            value={cancelReason}
            maxLength={CANCEL_REASON_MAX}
            autoFocus
            required
            aria-invalid={cancelMessage ? true : undefined}
            aria-describedby={cancelMessage ? 'cancel-reason-error' : undefined}
            onChange={(e) => { setCancelReason(e.target.value); setCancelTouched(true); setCancelServerError(null); }}
            onBlur={() => setCancelTouched(true)}
          />
          {cancelMessage ? <p id="cancel-reason-error" className="mt-1 text-xs text-red-700">{cancelMessage}</p> : null}
        </form>
      </Modal>

      <Modal
        open={dialog}
        title="Put this transaction on hold"
        onClose={busy ? undefined : () => setDialog(false)}
        returnFocusRef={holdButtonRef}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setDialog(false)} disabled={busy !== null}>Cancel</button>
            <button type="submit" form="hold-form" className="btn-primary" disabled={busy !== null || Boolean(reasonCheck.error)} aria-busy={busy === 'hold' || undefined}>
              {busy === 'hold' ? 'Putting on hold…' : 'Put on hold'}
            </button>
          </>
        }
      >
        <form id="hold-form" onSubmit={confirmHold} noValidate>
          <p className="mb-3 text-sm text-slate-600">Time on hold is not counted against the standard. Tell us why the work is paused.</p>
          <label htmlFor="hold-reason" className="label">Reason</label>
          <textarea
            id="hold-reason"
            className="input min-h-24"
            value={reason}
            maxLength={HOLD_REASON_MAX}
            autoFocus
            required
            aria-invalid={reasonMessage ? true : undefined}
            aria-describedby={reasonMessage ? 'hold-reason-error' : undefined}
            onChange={(e) => { setReason(e.target.value); setTouched(true); setServerReasonError(null); }}
            onBlur={() => setTouched(true)}
          />
          {reasonMessage ? <p id="hold-reason-error" className="mt-1 text-xs text-red-700">{reasonMessage}</p> : null}
        </form>
      </Modal>
    </div>
  );
}
