'use client';

import { useRef, useState } from 'react';
import { CALCULATION_TITLE, CALCULATION_UNAVAILABLE, calculationView } from '../../lib/ui/calculation.js';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import IconButton from '../ui/IconButton.js';

// S8-46: the one "How is this calculated?" control. An info button next to a chart, KPI or table opens a short panel with three
// parts: what the figure shows, how it is computed (the real steps) and the data used (records, dates, source). The calculation
// comes from the service that made the figure, so the panel never disagrees with the number.

function Section({ title, children }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The body of the "How is this calculated?" panel (what it shows, how it is computed, data used), without the
 * icon button or Modal around it - reused as-is where another panel folds this content into its own modal instead
 * of opening a separate one (for example the Chance of Finishing Late page's combined scoring/calculation info).
 * @param {{ calculation: object|null|undefined, subject?: string, testId?: string }} props
 */
export function CalculationBody({ calculation, subject = 'this figure', testId = 'calc-info' }) {
  const view = calculationView(calculation);
  return (
    <div className="space-y-5" data-testid={`${testId}-panel`}>
      {subject !== 'this figure' ? <p className="text-sm font-semibold text-ink">{subject.charAt(0).toUpperCase() + subject.slice(1)}</p> : null}
      {view ? (
        <>
          <Section title="What it shows">
            <p className="text-sm text-ink">{view.shows || CALCULATION_UNAVAILABLE}</p>
          </Section>
          <Section title="How it is computed">
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
              {view.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            {view.method ? <p className="text-xs text-ink-muted">Method: {view.method}</p> : null}
            {view.parameters.length > 0 ? (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs text-ink-muted">
                {view.parameters.map((p) => (
                  <div key={p.label} className="contents">
                    <dt>{p.label}</dt>
                    <dd className="text-right font-medium text-ink">{p.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </Section>
          <Section title="Data used">
            <dl className="space-y-1 text-sm">
              {view.data.map((row) => (
                <div key={row.label} className="flex flex-wrap justify-between gap-x-4">
                  <dt className="text-ink-muted">{row.label}</dt>
                  <dd className="font-medium text-ink">{row.value}</dd>
                </div>
              ))}
              {view.lastRun ? (
                <div className="flex flex-wrap justify-between gap-x-4">
                  <dt className="text-ink-muted">Last calculated</dt>
                  <dd className="font-medium text-ink">{view.lastRun}</dd>
                </div>
              ) : null}
            </dl>
          </Section>
        </>
      ) : (
        <p className="text-sm text-ink-muted" data-testid={`${testId}-unavailable`}>{CALCULATION_UNAVAILABLE}</p>
      )}
    </div>
  );
}

/** @param {{ calculation: object|null|undefined, subject?: string, testId?: string, className?: string }} props */
export default function CalculationInfo({ calculation, subject = 'this figure', testId = 'calc-info', className = '' }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);

  return (
    <>
      <IconButton
        ref={buttonRef}
        label={`How is ${subject} calculated?`}
        onClick={() => setOpen(true)}
        className={`h-7 w-7 shrink-0 ${className}`.trim()}
        data-testid={testId}
        aria-haspopup="dialog"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5" />
          <circle cx="10" cy="6.4" r="0.6" fill="currentColor" />
        </svg>
      </IconButton>
      <Modal
        open={open}
        title={CALCULATION_TITLE}
        onClose={() => setOpen(false)}
        showClose
        returnFocusRef={buttonRef}
        widthClass="max-w-lg"
        footer={<Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>}
      >
        <CalculationBody calculation={calculation} subject={subject} testId={testId} />
      </Modal>
    </>
  );
}
