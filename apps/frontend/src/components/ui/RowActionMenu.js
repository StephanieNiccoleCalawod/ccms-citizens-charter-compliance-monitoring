'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

const MENU_WIDTH = 192;
const ITEM_HEIGHT = 40;
const ITEM_SELECTOR = '[role="menuitem"]:not([disabled])';
const ITEM_CLASS =
  'flex h-10 w-full items-center px-4 text-left text-sm hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Horizontal three-dot (⋯) menu for table rows, shared by every CCMS table.
 * items: [{ label, onSelect?, href?, danger?, disabled? }] - an item with `href` renders as a link
 * (for example View), any other item renders as a button that calls `onSelect`.
 * The menu is positioned with `fixed` so the table's overflow clipping never cuts it off.
 * Callers decide which items a user may see; pass an empty list to render nothing.
 * `vertical` draws the dots top to bottom.
 * `trigger` replaces the dots with custom content (with `triggerClassName` for the button), and
 * `buttonRef` lets the caller keep a ref to the trigger, for example to return focus to it.
 */
export default function RowActionMenu({ items, label = 'Row actions', vertical = false, trigger = null, triggerClassName = null, buttonRef: externalRef = null }) {
  const [pos, setPos] = useState(null); // { top, left } when open
  const ownRef = useRef(null);
  const buttonRef = externalRef ?? ownRef;
  const menuRef = useRef(null);
  const menuId = useId();
  const open = pos !== null;

  function close(returnFocus = false) {
    setPos(null);
    // preventScroll: moving focus back must not scroll the table (a scroll also dismisses the menu).
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  }

  function toggle() {
    if (open) return close();
    const rect = buttonRef.current.getBoundingClientRect();
    const height = items.length * ITEM_HEIGHT + 16;
    const fitsBelow = rect.bottom + height + 8 <= window.innerHeight;
    setPos({
      top: fitsBelow ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (menuRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) return;
      setPos(null);
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setPos(null);
        buttonRef.current?.focus({ preventScroll: true });
      }
    }
    const dismiss = () => setPos(null);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    menuRef.current?.querySelector(ITEM_SELECTOR)?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open, buttonRef]);

  function onMenuKeyDown(event) {
    if (event.key === 'Tab') {
      // Let Tab move on from the trigger rather than from a menu that is about to disappear.
      close(true);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const els = [...menuRef.current.querySelectorAll(ITEM_SELECTOR)];
    if (els.length === 0) return;
    const index = els.indexOf(document.activeElement);
    let next;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = els.length - 1;
    else if (event.key === 'ArrowDown') next = (index + 1) % els.length;
    else next = (index - 1 + els.length) % els.length;
    els[next]?.focus({ preventScroll: true });
  }

  if (!items || items.length === 0) return null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={toggle}
        className={triggerClassName ?? 'row-icon-button'}
      >
        {trigger ?? (
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
          {vertical ? (
            <>
              <circle cx="10" cy="4" r="1.6" />
              <circle cx="10" cy="10" r="1.6" />
              <circle cx="10" cy="16" r="1.6" />
            </>
          ) : (
            <>
              <circle cx="4" cy="10" r="1.6" />
              <circle cx="10" cy="10" r="1.6" />
              <circle cx="16" cy="10" r="1.6" />
            </>
          )}
        </svg>
        )}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="z-50 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg"
        >
          {items.map((item) => {
            const tone = item.danger ? 'text-red-700' : 'text-slate-700';
            if (item.href) {
              return (
                <Link key={item.label} role="menuitem" href={item.href} onClick={() => close()} className={`${ITEM_CLASS} ${tone}`}>
                  {item.label}
                </Link>
              );
            }
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  // Focus the trigger before this item is removed, so a dialog opened by onSelect
                  // records the trigger (not the vanishing menu item) as the element to return to.
                  close(true);
                  item.onSelect();
                }}
                className={`${ITEM_CLASS} ${tone}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
