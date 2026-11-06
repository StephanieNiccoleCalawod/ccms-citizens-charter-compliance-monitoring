'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { filterOptions, firstEnabled, lastEnabled, stepEnabled } from '../../lib/ui/searchable-select.js';

/**
 * A searchable single-choice dropdown (ARIA combobox with a listbox) used where a native <select> is too long to read.
 * The list is drawn by the page, not by the operating system, so it stays exactly as wide as the field, long names wrap, and
 * the field never makes the form or modal wider. Keyboard: type to search, Up/Down/Home/End to move, Enter to choose,
 * Escape to close (and only close: the modal behind it stays open), Tab leaves.
 *
 * options: [{ value, label, secondary?, search?, disabled? }]  label is the main text, secondary a smaller line (for example the office),
 *          search the text matched against what was typed (defaults to label + secondary). A `disabled` option (an inactive record,
 *          see lib/ui/record-status.js) stays listed in gray but cannot be highlighted, stepped onto or chosen.
 */
export default function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = 'Search or select',
  loadingText,
  emptyText = 'No options.',
  noMatchText = 'No match.',
  disabled = false,
  invalid = false,
  describedBy,
  required = false,
  clearLabel = 'Clear selection',
  listMinWidth = 0,
  clearable = true,
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const fieldRef = useRef(null);
  const [box, setBox] = useState(null); // where the list is drawn: fixed to the screen, so no scrolling parent can clip it
  const selected = options.find((o) => o.value === value) ?? null;

  const matches = useMemo(() => filterOptions(options, query), [options, query]);

  // The list is positioned from the field's place on screen: below it, or above it when there is little room below.
  const place = useCallback(() => {
    const field = fieldRef.current;
    if (!field) return;
    const rect = field.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 180 && above > below;
    const maxHeight = Math.max(120, Math.min(256, up ? above : below));
    // A narrow field may open a wider list (listMinWidth), kept inside the screen.
    const width = Math.min(Math.max(rect.width, listMinWidth), window.innerWidth - 16);
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setBox({ left, width, maxHeight, ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  }, [listMinWidth]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // any scrolling parent, such as the modal body
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  function openList() {
    if (disabled) return;
    setOpen(true);
    const at = matches.findIndex((o) => o.value === value && !o.disabled);
    setActive(at >= 0 ? at : firstEnabled(matches));
  }

  function close() {
    setOpen(false);
    setQuery('');
  }

  function choose(option) {
    if (option?.disabled) return; // an inactive record can never be newly chosen
    onChange(option ? option.value : '');
    close();
  }

  // A click or tap outside closes the list.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // The highlighted option stays in view while moving with the keyboard.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  function onKeyDown(event) {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openList();
        return;
      }
      if (matches.length === 0) return;
      setActive((i) => stepEnabled(matches, i, event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActive(firstEnabled(matches));
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      setActive(lastEnabled(matches));
    } else if (event.key === 'Enter') {
      if (open) {
        event.preventDefault(); // never submits the form while the list is open
        if (matches[active] && !matches[active].disabled) choose(matches[active]);
      }
    } else if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        event.stopPropagation(); // closes the list only, not the modal around it
        close();
      }
    }
  }

  const shown = open ? query : (selected?.label ?? '');
  const placeholderText = loadingText ?? (options.length === 0 ? emptyText : placeholder);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <div className="relative" ref={fieldRef}>
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
          aria-required={required || undefined}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          className={`input w-full truncate ${clearable ? 'pr-16' : 'pr-9'}`}
          title={!open && selected ? selected.label : undefined}
          placeholder={placeholderText}
          value={shown}
          disabled={disabled}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(firstEnabled(filterOptions(options, e.target.value)));
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {clearable && selected && !disabled ? (
            <button
              type="button"
              aria-label={clearLabel}
              title={clearLabel}
              className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
              onClick={() => choose(null)}
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          ) : null}
          <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none h-4 w-4 text-slate-500" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m5 8 5 5 5-5" />
          </svg>
        </div>
      </div>
      {!open && selected?.secondary ? <p className="mt-1 break-words text-xs text-slate-500">{selected.secondary}</p> : null}
      {open ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          style={box ?? { visibility: 'hidden' }}
          className="fixed z-[70] overflow-y-auto overflow-x-hidden rounded-md border border-slate-300 bg-white py-1 shadow-lg"
        >
          {matches.length === 0 ? (
            <li role="presentation" className="px-3 py-2 text-sm text-slate-500">
              {options.length === 0 ? emptyText : noMatchText}
            </li>
          ) : (
            matches.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                data-active={index === active ? 'true' : undefined}
                className={`px-3 py-2 text-sm ${option.disabled ? 'cursor-not-allowed text-slate-400' : `cursor-pointer ${index === active ? 'bg-maroon-50' : ''} ${option.value === value ? 'font-semibold text-maroon-900' : 'text-slate-800'}`}`}
                onMouseEnter={() => (option.disabled ? undefined : setActive(index))}
                onMouseDown={(event) => event.preventDefault()} // keep focus in the input
                onClick={() => choose(option)}
              >
                <span className="block break-words">{option.label}</span>
                {option.secondary ? <span className={`block break-words text-xs font-normal ${option.disabled ? 'text-slate-400' : 'text-slate-500'}`}>{option.secondary}</span> : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
