'use client';

import { useRef } from 'react';

/**
 * Accessible tabs (WAI-ARIA tabs pattern): one tab stop, Left/Right/Home/End move between tabs and select them.
 *   <Tabs label="Calendar sections" tabs={[{ id: 'hours', label: 'Working hours' }, …]} value={tab} onChange={setTab} idPrefix="cal" />
 *   <div {...tabPanelProps('cal', tab)}>…</div>
 * Variants: 'default' (maroon label + gold bottom bar) and 'analytics' (thin #800000 underline, badges, and right supporting note).
 */
export function tabPanelProps(idPrefix, value) {
  return { role: 'tabpanel', id: `${idPrefix}-panel-${value}`, 'aria-labelledby': `${idPrefix}-tab-${value}`, tabIndex: 0 };
}

function badgeClass(tone) {
  if (tone === 'gold') return 'border border-[#F0DDB0] bg-[#FEF3C7] text-[#800000]';
  return 'border border-[#E2E8F0] bg-[#F4F5F8] text-[#475569]';
}

export default function Tabs({
  tabs,
  value,
  onChange,
  label,
  idPrefix = 'tabs',
  variant = 'default',
  supportingText = null,
  className = '',
}) {
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
    const btn = listRef.current?.querySelector(`#${CSS.escape(`${idPrefix}-tab-${target.id}`)}`);
    btn?.focus();
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  if (variant === 'analytics') {
    return (
      <div
        className={`flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between lg:border-b lg:border-[#E2E8F0] ${className}`.trim()}
        data-testid={`${idPrefix}-tabs-bar`}
      >
        <div className="relative min-w-0 lg:flex-1">
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[#E2E8F0] lg:hidden" />
          <div
            ref={listRef}
            role="tablist"
            aria-label={label}
            onKeyDown={onKeyDown}
            className="relative flex flex-nowrap items-center gap-3.5 overflow-x-auto md:gap-4 lg:-mb-px xl:gap-5"
          >
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
                  data-testid={`${idPrefix}-tab-${t.id}`}
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 bg-transparent px-0.5 py-2.5 font-sans text-[13px] leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-1 ${
                    selected
                      ? 'border-[#800000] font-semibold text-[#800000]'
                      : 'border-transparent font-medium text-[#64748B] hover:text-[#202938]'
                  }`}
                >
                  <span>{t.label}</span>
                  {t.badge !== undefined && t.badge !== null ? (
                    <span
                      data-testid={`${idPrefix}-tab-badge-${t.id}`}
                      className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-sans text-[10px] font-semibold leading-none tabular-nums ${badgeClass(t.badgeTone)}`}
                    >
                      {t.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
        {supportingText ? (
          <p
            data-testid={`${idPrefix}-tabs-supporting`}
            className="shrink-0 font-sans text-[11px] leading-tight text-[#64748B] xl:text-xs lg:whitespace-nowrap lg:pb-2.5 lg:pl-3 lg:text-right"
          >
            {supportingText}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div ref={listRef} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={`flex flex-nowrap items-end gap-4 overflow-x-auto border-b border-[#E2E8F0] sm:gap-6 ${className}`.trim()}>
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
            className={`-mb-px inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 bg-transparent px-1 py-2.5 font-sans text-sm leading-tight transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-1 ${
              selected
                ? 'border-[#800000] font-semibold text-[#800000]'
                : 'border-transparent font-medium text-[#64748B] hover:text-[#202938]'
            }`}
          >
            <span>{t.label}</span>
            {t.badge !== undefined && t.badge !== null ? (
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-sans text-[10px] font-semibold leading-none tabular-nums ${badgeClass(t.badgeTone)}`}
              >
                {t.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
