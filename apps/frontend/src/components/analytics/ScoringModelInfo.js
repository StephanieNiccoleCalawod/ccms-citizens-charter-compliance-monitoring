'use client';

import { useRef, useState } from 'react';
import Modal from '../modals/Modal.js';
import Button from '../ui/Button.js';
import IconButton from '../ui/IconButton.js';
import StatusBadge from '../ui/StatusBadge.js';
import { CalculationBody } from './CalculationInfo.js';
import { LateRiskModelSummary, modelBadgeFor } from './LateRiskSection.js';

/**
 * The one information panel for the Chance of Finishing Late page: how the figure is calculated (CalculationBody,
 * reused from CalculationInfo.js, which still opens its own separate panel everywhere else it is used) plus the
 * "Scoring model" panel (how the risk levels are worked out), moved here from a permanent right-side column and
 * the page's own duplicate info icon - a single info button next to the page title (see AppShell's headerRight in
 * app/late-risk/page.js). The figures themselves are unchanged and come from the same place (LateRiskSection.js
 * reports them up via `onInfoChange` as they load, since this button lives in the page header, outside that
 * component's own tree).
 */
export default function ScoringModelInfo({ model, calculation }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const badge = modelBadgeFor(model);

  return (
    <>
      <IconButton
        ref={buttonRef}
        label="View scoring model information"
        onClick={() => setOpen(true)}
        className="h-9 w-9 shrink-0"
        data-testid="scoring-model-info-button"
        aria-haspopup="dialog"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.25" />
          <path d="M10 9v4.5" />
          <circle cx="10" cy="6.4" r="0.6" fill="currentColor" />
        </svg>
      </IconButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="How risk is calculated and scored"
        showClose
        returnFocusRef={buttonRef}
        widthClass="max-w-md"
        footer={<Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>}
      >
        <div className="space-y-6">
          <CalculationBody calculation={calculation} subject="the chance of finishing late" testId="late-risk-calc" />
          <div className="space-y-4 border-t border-[#E2E8F0] pt-5" data-testid="late-risk-model-panel">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Scoring model</h3>
              <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
            </div>
            <LateRiskModelSummary model={model} />
          </div>
        </div>
      </Modal>
    </>
  );
}
