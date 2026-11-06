'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { register } from '../../lib/ui/dirty-registry.js';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open modals, innermost last: only the top one handles Escape, Tab and stray focus.
const openStack = [];
// How many open modals hold the page scroll lock, and the page's own overflow value to restore.
const scrollLocks = { count: 0, previous: '' };

function focusables(panel) {
  return [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

function focusSafely(el) {
  if (el && el.isConnected && typeof el.focus === 'function') {
    el.focus({ preventScroll: true });
    return document.activeElement === el;
  }
  return false;
}

/**
 * Accessible modal: labelled by its title, focus moves inside on open (an autoFocus field keeps it),
 * Tab stays inside, Escape closes when onClose is given (pass none to block dismissal, e.g. while
 * saving), and focus returns to the control that opened it (or returnFocusRef) on close.
 * dirty (optional) tells Sign out that the open form has unsaved changes.
 * showClose adds an X button in the header (it calls onClose, and is left out when onClose is not given, e.g. while saving).
 * flushBody gives the children the whole body with no padding or scrolling of its own, for a form that lays out its own scrolling
 * area and footer (the Add Transaction form).
 * The panel is at most 90% of the screen high: the title bar and footer stay put and only the body scrolls. Its width is the
 * smaller of widthClass and the screen minus the 16px margins, so it never overflows sideways.
 * fullScreenOnMobile makes the panel fill the screen below the sm breakpoint. While any modal is open the page behind does not scroll.
 */
export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  widthClass = 'max-w-lg',
  role = 'dialog',
  describedBy,
  initialFocusRef,
  returnFocusRef,
  dirty,
  showClose = false,
  fullScreenOnMobile = false,
  flushBody = false,
}) {
  const titleId = useId();
  const stackId = useId();
  const panelRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const dirtyRef = useRef(Boolean(dirty));
  const tracksDirty = dirty !== undefined;

  // Remember what had focus just before opening (read while rendering, before any autoFocus runs).
  const [opener, setOpener] = useState({ open: false, element: null });
  if (open !== opener.open) {
    setOpener({ open, element: open && typeof document !== 'undefined' ? document.activeElement : null });
  }

  useEffect(() => {
    onCloseRef.current = onClose;
    dirtyRef.current = Boolean(dirty);
  });

  // The page behind a modal does not scroll; the last modal to close gives scrolling back.
  useEffect(() => {
    if (!open) return undefined;
    if (scrollLocks.count === 0) scrollLocks.previous = document.body.style.overflow;
    scrollLocks.count += 1;
    document.body.style.overflow = 'hidden';
    return () => {
      scrollLocks.count -= 1;
      if (scrollLocks.count === 0) document.body.style.overflow = scrollLocks.previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !tracksDirty) return undefined;
    return register(stackId, () => dirtyRef.current);
  }, [open, tracksDirty, stackId]);

  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const trigger = opener.element;
    const returnTarget = returnFocusRef?.current;
    openStack.push(stackId);
    const isTop = () => openStack[openStack.length - 1] === stackId;

    if (panel && !panel.contains(document.activeElement)) {
      if (!focusSafely(initialFocusRef?.current)) {
        if (!focusSafely(focusables(panel)[0])) panel.focus({ preventScroll: true });
      }
    }

    const onKeyDown = (event) => {
      if (!isTop() || !panel) return;
      if (event.key === 'Escape') {
        if (onCloseRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusables(panel);
      if (items.length === 0) {
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panel.contains(active);
      if (event.shiftKey && (outside || active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || active === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Focus that escapes (a click outside, assistive tech) is brought back inside.
    const onFocusIn = (event) => {
      if (isTop() && panel && !panel.contains(event.target)) {
        if (!focusSafely(focusables(panel)[0])) panel.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      const index = openStack.lastIndexOf(stackId);
      if (index !== -1) openStack.splice(index, 1);
      // Give focus back; skip triggers that were removed from the page (e.g. a closed row menu).
      if (!focusSafely(returnTarget)) focusSafely(trigger);
    };
  }, [open, opener.element, stackId, initialFocusRef, returnFocusRef]);

  if (!open) return null;
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${fullScreenOnMobile ? 'p-0 sm:p-4' : 'p-4'}`}>
      <div className="absolute inset-0 bg-slate-900/50" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={`relative flex w-full ${widthClass} card flex-col overflow-hidden focus:outline-none ${fullScreenOnMobile ? 'h-full max-h-full rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-xl' : 'max-h-[90vh]'}`}
      >
        <div className={'flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-6 py-4'}>
          <h2 id={titleId} className="text-xl">
            {title}
          </h2>
          {showClose && onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500"
            >
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className={flushBody ? 'flex min-h-0 flex-1 flex-col' : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 py-5'}>{children}</div>
        {footer ? <div className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-6 py-4">{footer}</div> : null}
      </div>
    </div>
  );
}
