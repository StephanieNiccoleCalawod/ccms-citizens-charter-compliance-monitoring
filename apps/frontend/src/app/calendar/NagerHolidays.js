'use client';

import { useState } from 'react';
import ErrorBanner from '../../components/feedback/ErrorBanner.js';
import Modal from '../../components/modals/Modal.js';
import SubmitButton from '../../components/ui/SubmitButton.js';
import { apiFetch } from '../../lib/auth/session.js';
import { formatDate } from '../../lib/ui/date-format.js';

export default function NagerHolidays({ initialYear, onClose, onReview }) {
  const [year, setYear] = useState(String(initialYear));
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setPreview(null);
    setError(null);
    try {
      setPreview(await apiFetch(`/api/calendar/holidays/nager?year=${encodeURIComponent(year)}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open title="Philippine holidays from Nager.Date" onClose={onClose} showClose>
      <p className="mb-4 text-sm text-slate-600">
        Check each date and holiday type against the official Philippine calendar before saving.
      </p>
      <form onSubmit={load} className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-28">
          <label className="label" htmlFor="nager-holiday-year">Year</label>
          <input id="nager-holiday-year" className="input" type="number" min="1900" max="2200"
            value={year} onChange={(event) => setYear(event.target.value)} disabled={loading} required />
        </div>
        <SubmitButton busy={loading} label="Fetch holidays" busyLabel="Fetching…" />
      </form>
      <ErrorBanner message={error} />
      {preview && (
        <section aria-label={`Nager.Date results for ${preview.year}`}>
          <p className="text-sm font-semibold">{preview.year} results</p>
          {preview.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Nager.Date returned no nationwide public holidays for this year.</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100">
              {preview.items.map((holiday) => (
                <li key={`${holiday.date}-${holiday.name}`} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div>
                    <p className="font-medium">{holiday.name}</p>
                    <p className="text-slate-600">{formatDate(holiday.date)}</p>
                  </div>
                  <button type="button" className="btn-link shrink-0" onClick={() => onReview(holiday)}
                    aria-label={`Review ${holiday.name}, ${formatDate(holiday.date)}`}>Review</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </Modal>
  );
}
