'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmDialog from '../dialogs/ConfirmDialog.js';
import StatusBanner from '../feedback/StatusBanner.js';
import { notify } from '../../lib/ui/notify.js';
import { todayManila } from '../../lib/api/calendar.js';
import { deleteReceipt, fetchReceiptImage, getReceipt, uploadReceipt } from '../../lib/api/receipts.js';
import { formatDate, formatDateTime } from '../../lib/ui/date-format.js';
import { EMPTY_RECEIPT_FORM, RECEIPT_ACCEPT, formatAmount, receiptFailure, receiptFormErrors } from '../../lib/ui/receipts.js';

const LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-500';

// CC045 proof of payment on transaction detail: Office Staff / Office Head of the office and Super Admin. Never rendered for an
// Executive (TransactionDetail checks canSeeReceipts) and the server answers 403 regardless. The photo is fetched with the session
// and shown from a local object URL that is released when the panel closes; nothing is cached or linked publicly.
export default function ReceiptPanel({ transactionId }) {
  const [state, setState] = useState({ loading: true, receipt: null, message: null });
  const [form, setForm] = useState({ ...EMPTY_RECEIPT_FORM });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(null); // 'upload' | 'delete' | 'view'
  const [imageUrl, setImageUrl] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef(null);

  const forget = useCallback(() => setImageUrl((url) => {
    if (url) URL.revokeObjectURL(url);
    return null;
  }), []);
  useEffect(() => forget, [forget]);

  const load = useCallback(async () => {
    try {
      const { receipt } = await getReceipt(transactionId);
      setState({ loading: false, receipt, message: null });
    } catch (err) {
      setState({ loading: false, receipt: null, message: err?.status === 403 ? null : 'The receipt details could not be loaded.' });
    }
  }, [transactionId]);
  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  async function submit(event) {
    event.preventDefault();
    const found = receiptFormErrors(form, todayManila());
    setErrors(found);
    if (Object.keys(found).length || busy) return;
    setBusy('upload');
    try {
      const { receipt } = await uploadReceipt(transactionId, form);
      setState({ loading: false, receipt, message: null });
      setForm({ ...EMPTY_RECEIPT_FORM });
      if (fileInput.current) fileInput.current.value = '';
      notify.success('Receipt attached.');
    } catch (err) {
      const { fields, message } = receiptFailure(err);
      setErrors(fields);
      if (message) notify.error(message);
      if (err?.code === 'RECEIPT_EXISTS') load();
    } finally {
      setBusy(null);
    }
  }

  async function view() {
    if (busy) return;
    setBusy('view');
    try {
      const blob = await fetchReceiptImage(transactionId);
      forget();
      setImageUrl(URL.createObjectURL(blob));
    } catch (err) {
      notify.error(err?.message || 'The receipt photo could not be loaded.');
      if (err?.status === 404) load();
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy('delete');
    try {
      await deleteReceipt(transactionId);
      forget();
      setState({ loading: false, receipt: null, message: null });
      notify.success('Receipt deleted.');
    } catch (err) {
      notify.error(err?.message || 'The receipt could not be deleted.');
      load();
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  const receipt = state.receipt;
  const field = (name) => ({ 'aria-invalid': errors[name] ? true : undefined, 'aria-describedby': errors[name] ? `receipt-${name}-error` : undefined });
  const fieldError = (name) => (errors[name] ? <p id={`receipt-${name}-error`} className="mt-1 text-xs text-red-700">{errors[name]}</p> : null);
  return (
    <section className="mt-6 border-t border-line pt-4" aria-labelledby="receipt-heading" data-testid="receipt-panel">
      <h3 id="receipt-heading" className="text-sm font-semibold text-slate-700">Proof of payment</h3>
      {state.loading ? <p className="mt-2 text-sm text-slate-500">Loading…</p> : null}
      {state.message ? <StatusBanner variant="error" message={state.message} /> : null}
      {!state.loading && receipt ? (
        <div className="mt-2 space-y-3">
          <dl className="grid gap-4 sm:grid-cols-3">
            <div><dt className={LABEL}>OR number</dt><dd className="font-mono text-sm text-slate-800" data-testid="receipt-or">{receipt.or_number}</dd></div>
            <div><dt className={LABEL}>Amount</dt><dd className="text-sm text-slate-800" data-testid="receipt-amount">{formatAmount(receipt.amount)}</dd></div>
            <div><dt className={LABEL}>Receipt date</dt><dd className="text-sm text-slate-800">{formatDate(receipt.receipt_date) || '-'}</dd></div>
          </dl>
          <p className="text-xs text-slate-500">Attached {formatDateTime(receipt.uploaded_at) || '-'} (Asia/Manila).</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-secondary" onClick={imageUrl ? forget : view} disabled={busy !== null}>
              {busy === 'view' ? 'Loading photo…' : imageUrl ? 'Hide photo' : 'View photo'}
            </button>
            <button type="button" className="btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>Delete receipt</button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- a private, session-fetched object URL; not an optimisable asset */}
          {imageUrl ? <img src={imageUrl} alt={`Cashier receipt ${receipt.or_number}`} className="max-h-[32rem] max-w-full rounded border border-slate-200" /> : null}
        </div>
      ) : null}
      {!state.loading && !receipt && !state.message ? (
        <form className="mt-2 grid max-w-xl gap-3" onSubmit={submit} noValidate aria-label="Attach a receipt">
          <div>
            <label className="label" htmlFor="receipt-file">Receipt photo (JPG or PNG, up to 2 MB)</label>
            <input ref={fileInput} id="receipt-file" type="file" accept={RECEIPT_ACCEPT} className="input" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] ?? null }))} {...field('file')} />
            {fieldError('file')}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="receipt-or_number">OR number</label>
              <input id="receipt-or_number" className="input font-mono" inputMode="text" maxLength={30} value={form.or_number} onChange={(e) => setForm((f) => ({ ...f, or_number: e.target.value }))} {...field('or_number')} />
              {fieldError('or_number')}
            </div>
            <div>
              <label className="label" htmlFor="receipt-amount">Amount (₱)</label>
              <input id="receipt-amount" className="input" inputMode="decimal" placeholder="150.00" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} {...field('amount')} />
              {fieldError('amount')}
            </div>
            <div>
              <label className="label" htmlFor="receipt-receipt_date">Receipt date</label>
              <input id="receipt-receipt_date" type="date" className="input" max={todayManila()} value={form.receipt_date} onChange={(e) => setForm((f) => ({ ...f, receipt_date: e.target.value }))} aria-invalid={errors.receipt_date ? true : undefined} aria-describedby={errors.receipt_date ? 'receipt-receipt_date-error' : undefined} />
              {fieldError('receipt_date')}
            </div>
          </div>
          <div>
            <button type="submit" className="btn-primary" disabled={busy !== null} aria-busy={busy === 'upload' || undefined}>{busy === 'upload' ? 'Attaching…' : 'Attach receipt'}</button>
          </div>
        </form>
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete receipt"
        message="Delete this receipt photo and its details? This cannot be undone."
        confirmLabel="Delete"
        busy={busy === 'delete'}
        busyLabel="Deleting…"
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </section>
  );
}
