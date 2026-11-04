'use client';

import { useEffect, useRef } from 'react';
import { addStep, moveStep, removeStep, setStep } from '../../lib/ui/procedure-steps.js';

const ICON = { viewBox: '0 0 20 20', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, className: 'h-4 w-4' };
const BUTTON =
  'inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 disabled:cursor-not-allowed disabled:opacity-40';

/**
 * Ordered list of procedure steps: one single-line field per step with its number, move up, move down and
 * remove, and Add step. Numbers come from the position, so every change renumbers. Step text is plain text:
 * it is only ever put in an input's value, never rendered as HTML. Nothing but the text of a step is kept.
 */
export default function ProcedureStepsEditor({ id, steps, onChange, describedBy }) {
  const root = useRef(null);
  const focusAfter = useRef(null); // a selector to focus once the list has re-rendered

  useEffect(() => {
    if (!focusAfter.current) return;
    const target = root.current?.querySelector(focusAfter.current);
    focusAfter.current = null;
    target?.focus();
  });

  const at = (index, what) => `[data-step="${index}"][data-what="${what}"]`;

  function move(index, direction) {
    const next = index + direction;
    const lastIndex = steps.length - 1;
    // Keep focus on the same control at the step's new place (or the other arrow when it can go no further).
    const stillCanMove = direction < 0 ? next > 0 : next < lastIndex;
    focusAfter.current = at(next, stillCanMove ? (direction < 0 ? 'up' : 'down') : direction < 0 ? 'down' : 'up');
    onChange(moveStep(steps, index, direction));
  }

  function remove(index) {
    focusAfter.current = steps.length > 1 ? at(Math.min(index, steps.length - 2), 'text') : '[data-what="add"]';
    onChange(removeStep(steps, index));
  }

  function add() {
    focusAfter.current = at(steps.length, 'text');
    onChange(addStep(steps));
  }

  return (
    <div ref={root} className="space-y-3">
      {steps.length === 0 ? <p className="text-sm text-slate-500">No steps yet.</p> : null}
      <ol className="space-y-2" aria-label="Procedure steps">
        {steps.map((text, index) => {
          const n = index + 1;
          return (
            <li key={index} className="flex items-center gap-2">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maroon-800 text-sm font-bold text-white">
                {n}
              </span>
              <input
                id={`${id}-step-${n}`}
                data-step={index}
                data-what="text"
                className="input min-w-0 flex-1"
                value={text}
                onChange={(e) => onChange(setStep(steps, index, e.target.value.replace(/[\r\n]+/g, ' ')))}
                aria-label={`Step ${n}`}
                aria-describedby={describedBy}
                autoComplete="off"
              />
              <button type="button" className={BUTTON} data-step={index} data-what="up" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move step ${n} up`}>
                <svg {...ICON}>
                  <path d="m5 12 5-5 5 5" />
                </svg>
              </button>
              <button type="button" className={BUTTON} data-step={index} data-what="down" onClick={() => move(index, 1)} disabled={index === steps.length - 1} aria-label={`Move step ${n} down`}>
                <svg {...ICON}>
                  <path d="m5 8 5 5 5-5" />
                </svg>
              </button>
              <button type="button" className={BUTTON} data-step={index} data-what="remove" onClick={() => remove(index)} aria-label={`Remove step ${n}`}>
                <svg {...ICON}>
                  <path d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            </li>
          );
        })}
      </ol>
      <button type="button" className="btn-secondary px-3 py-1.5" data-what="add" onClick={add}>
        + Add step
      </button>
    </div>
  );
}
