'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * The single "Risk Level" dropdown that replaced the four separate All/High/Medium/Low filter buttons: one
 * trigger (styled like the other selects in this toolbar) opens a listbox with a colored dot and a live count
 * beside each option, same as the buttons it replaced - just one control instead of four.
 * options: [{ id, label, count, dot: 'bg-...' | null }]
 */
export default function RiskLevelDropdown({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const selected = options.find((o) => o.id === value) ?? options[0];

  function close(returnFocus = false) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  }

  function choose(option) {
    onChange(option.id);
    close(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (listRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') { setOpen(false); buttonRef.current?.focus({ preventScroll: true }); }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function onButtonKeyDown(event) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
    }
  }

  function onListKeyDown(event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = options.findIndex((o) => o.id === value);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else if (event.key === 'ArrowDown') next = (index + 1) % options.length;
    else next = (index - 1 + options.length) % options.length;
    choose(options[next]);
  }

  return (
    <div className="relative" data-testid="late-risk-filters">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label="Risk Level"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onButtonKeyDown}
        data-testid="late-risk-level-trigger"
        className="input select-chevron flex w-full items-center gap-2 text-left font-medium sm:w-56"
      >
        {selected.dot ? <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${selected.dot}`} /> : null}
        <span className="truncate">{selected.label}</span>
        <span className="font-mono text-xs tabular-nums text-[#64748B]">({selected.count})</span>
      </button>
      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label="Risk Level"
          tabIndex={-1}
          onKeyDown={onListKeyDown}
          className="absolute right-0 z-30 mt-1 w-full min-w-[14rem] overflow-hidden rounded-lg border border-[#E2E8F0] bg-white py-1 shadow-lg sm:left-0 sm:right-auto"
        >
          {options.map((option) => {
            const isSelected = option.id === value;
            return (
              <li
                key={option.id}
                role="option"
                aria-selected={isSelected}
                data-testid={option.testId}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ${isSelected ? 'bg-maroon-50 font-semibold text-maroon-900' : 'text-[#202938] hover:bg-slate-50'}`}
                onClick={() => choose(option)}
              >
                {option.dot ? <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${option.dot}`} /> : <span aria-hidden="true" className="h-2 w-2 shrink-0" />}
                <span className="flex-1 truncate">{option.label}</span>
                <span className="font-mono text-xs tabular-nums text-[#64748B]">({option.count})</span>
                {isSelected ? (
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-maroon-700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m4 10 4 4 8-8" />
                  </svg>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
