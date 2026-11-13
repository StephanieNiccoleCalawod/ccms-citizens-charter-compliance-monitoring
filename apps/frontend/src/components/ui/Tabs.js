'use client';

import { useRef } from 'react';

/**
 * Accessible tabs (WAI-ARIA tabs pattern): one tab stop, Left/Right/Home/End move between tabs and select them.
 *   <Tabs label="Calendar sections" tabs={[{ id: 'hours', label: 'Working hours' }, …]} value={tab} onChange={setTab} idPrefix="cal" />
 *   <div {...tabPanelProps('cal', tab)}>…</div>
 * The look: underline tabs, the selected one in maroon with the gold bar.
 */
export function tabPanelProps(idPrefix, value) {
  return { role: 'tabpanel', id: `${idPrefix}-panel-${value}`, 'aria-labelledby': `${idPrefix}-tab-${value}`, tabIndex: 0 };
}

export default function Tabs({ tabs, value, onChange, label, idPrefix = 'tabs', className = '' }) {
  const listRef = useRef(null);

  function onKeyDown(event) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex((t) => t.id === value);
    let next = index;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else next = (index - 1 + tabs.length) % tabs.length;
    const target = tabs[next];
    onChange(target.id);
    listRef.current?.querySelector(`#${CSS.escape(`${idPrefix}-tab-${target.id}`)}`)?.focus();
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex flex-wrap items-end gap-1 border-b border-slate-200 ${className}`.trim()}>
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`-mb-px whitespace-nowrap border-b-4 px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700 ${
              selected ? 'border-gold-500 text-maroon-800' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
