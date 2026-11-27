'use client';

import { useMemo, useRef, useState } from 'react';
import SearchInput from '../forms/SearchInput.js';
import TableShell, { GroupRow, RowHeader, Table, Th } from '../ui/TableShell.js';
import TableState from '../ui/TableState.js';
import Checkbox from '../ui/Checkbox.js';
import {
  accessBadgeMeta,
  countSwitchControlledRows,
  filterCapabilityRows,
  groupRows,
  isSwitchCell,
  isSwitchControlledRow,
  roleMeta,
  summarizeCategories,
  switchScopeSummary,
} from '../../lib/ui/account.js';

function ModuleIcon({ group }) {
  const common = 'h-4 w-4 shrink-0 text-[#800000]';
  switch (group) {
    case 'Administration':
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6h7M15 6h1M4 14h2M10 14h6M13 4v4M8 12v4" />
        </svg>
      );
    case 'Reference':
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M5 3.5h8.5a1.5 1.5 0 0 1 1.5 1.5v11.5l-5-2.5-5 2.5V3.5Z" />
        </svg>
      );
    case 'Transactions':
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 7h11m-3-3 3 3-3 3M16 13H5m3 3-3-3 3-3" />
        </svg>
      );
    case 'Analytics':
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 15.5h12M6.5 13V9.5M10 13V6.5M13.5 13V4.5" />
        </svg>
      );
    case 'Reports':
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3.5h5.5L15 7v9.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" />
          <path d="M11.5 3.5V7H15M7.5 10.5h5M7.5 13.5h3.5" />
        </svg>
      );
    case 'Complaints':
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 4.5h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H8l-4 3v-11a1 1 0 0 1 1-1Z" />
          <path d="M10 7.5v2.5M10 11.75h.01" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 20 20" className={common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="4" width="12" height="12" rx="2" />
        </svg>
      );
  }
}

function ScopeIcon({ kind }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (kind) {
    case 'yes':
    case 'switch_on':
      return (
        <svg viewBox="0 0 20 20" className={cls} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="10" r="7" />
          <path d="m7 10 2 2 4-4" />
        </svg>
      );
    case 'own_office':
      return (
        <svg viewBox="0 0 20 20" className={cls} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 16.5V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v11.5M11 9h4a1 1 0 0 1 1 1v6.5M2.5 16.5h15" />
        </svg>
      );
    case 'own_records':
      return (
        <svg viewBox="0 0 20 20" className={cls} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="10" cy="6.5" r="2.75" />
          <path d="M4.5 16c0-2.6 2.5-4.5 5.5-4.5s5.5 1.9 5.5 4.5" />
        </svg>
      );
    case 'read_only':
      return (
        <svg viewBox="0 0 20 20" className={cls} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2.5 10s3-5 7.5-5 7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" />
          <circle cx="10" cy="10" r="2" />
        </svg>
      );
    case 'switch_off':
      return (
        <svg viewBox="0 0 20 20" className={cls} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2.5" y="6" width="15" height="8" rx="4" />
          <circle cx="6.5" cy="10" r="2" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
}

function PermissionCellBadge({ cell, switchOn }) {
  const meta = accessBadgeMeta(cell, switchOn);
  if (meta.kind === 'no') {
    return (
      <span
        title={meta.tooltip}
        className="inline-flex items-center gap-1 font-sans text-xs font-medium text-slate-400"
      >
        <span aria-hidden="true">&mdash;</span>
        <span>{meta.label}</span>
      </span>
    );
  }
  return (
    <span
      title={meta.tooltip}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 font-sans text-xs font-semibold ${meta.className}`}
    >
      <ScopeIcon kind={meta.kind} />
      <span>{meta.label}</span>
    </span>
  );
}

/**
 * Grouped RBAC permission matrix with category filtering, capability search, highlight toggle for switch-controlled
 * permissions, dynamic access scope legend, collapsible module sections, and inline ON/OFF toggle switches for
 * switch-controlled permissions when authorized (`canToggle` + `onToggleSwitch`). Fixed role permissions remain read-only.
 */
export default function RolesMatrix({
  matrix,
  switches = [],
  switchOn = {},
  offices = [],
  roleCounts = null,
  canToggle = false,
  busySwitchKey = null,
  onToggleSwitch = null,
}) {
  const [category, setCategory] = useState('ALL');
  const [query, setQuery] = useState('');
  const [highlightSwitch, setHighlightSwitch] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const tabListRef = useRef(null);

  const matrixRows = matrix?.rows;
  const { total, categories } = useMemo(() => summarizeCategories(matrixRows), [matrixRows]);
  const switchCount = useMemo(() => countSwitchControlledRows(matrixRows), [matrixRows]);
  const switchInfoMap = useMemo(() => new Map((switches ?? []).map((s) => [s.key, s])), [switches]);

  const tabOrder = useMemo(() => ['ALL', ...categories.map((cat) => cat.name)], [categories]);

  const onTabKeyDown = (event) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key) || tabOrder.length === 0) return;
    event.preventDefault();
    const index = Math.max(0, tabOrder.indexOf(category));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabOrder.length - 1
        : event.key === 'ArrowRight'
          ? (index + 1) % tabOrder.length
          : (index - 1 + tabOrder.length) % tabOrder.length;
    const nextCategory = tabOrder[nextIndex];
    setCategory(nextCategory);
    const btn = tabListRef.current?.querySelector(`[data-testid="roles-category-${CSS.escape(nextCategory)}"]`);
    btn?.focus();
    btn?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const visibleRows = useMemo(
    () => filterCapabilityRows(matrixRows, { category, query, switches }),
    [matrixRows, category, query, switches],
  );
  const groups = useMemo(() => groupRows(visibleRows), [visibleRows]);

  const toggleGroup = (name) => {
    setCollapsedGroups((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  return (
    <div data-testid="roles-matrix-table">
      <TableShell>
        {/* Category Filters, Switch Highlight Toggle, and Capability Search */}
        <div className="flex flex-col gap-3 border-b border-[#E2E8F0] bg-white px-4 py-3.5 xl:flex-row xl:items-center xl:justify-between">
          <div
            ref={tabListRef}
            role="tablist"
            aria-label="Filter permissions by module"
            onKeyDown={onTabKeyDown}
            className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 xl:flex-wrap xl:pb-0"
          >
            <button
              type="button"
              role="tab"
              aria-selected={category === 'ALL'}
              tabIndex={category === 'ALL' ? 0 : -1}
              data-testid="roles-category-ALL"
              onClick={() => setCategory('ALL')}
              className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-sans text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${
                category === 'ALL'
                  ? 'border-[#800000] bg-[#800000] font-semibold text-white'
                  : 'border-[#E2E8F0] bg-white font-medium text-[#202938] hover:border-[#800000]/50 hover:bg-[#F8FAFC]'
              }`}
            >
              <span>All</span>
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums ${
                  category === 'ALL' ? 'bg-white/20 text-white' : 'bg-[#F4F5F8] text-[#64748B]'
                }`}
              >
                {total}
              </span>
            </button>

            {categories.map((cat) => {
              const active = category === cat.name;
              return (
                <button
                  key={cat.name}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  data-testid={`roles-category-${cat.name}`}
                  onClick={() => setCategory(cat.name)}
                  className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 font-sans text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] ${
                    active
                      ? 'border-[#800000] bg-[#800000] font-semibold text-white'
                      : 'border-[#E2E8F0] bg-white font-medium text-[#202938] hover:border-[#800000]/50 hover:bg-[#F8FAFC]'
                  }`}
                >
                  <span>{cat.name}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[10px] font-bold tabular-nums ${
                      active ? 'bg-white/20 text-white' : 'bg-[#F4F5F8] text-[#64748B]'
                    }`}
                  >
                    {cat.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <label
              htmlFor="roles-highlight-switches"
              className={`inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 font-sans text-xs font-medium transition-colors ${
                highlightSwitch
                  ? 'border-[#D97706] bg-[#FFFBEB] text-[#92400E]'
                  : 'border-[#E2E8F0] bg-white text-[#202938] hover:bg-[#F8FAFC]'
              }`}
            >
              <Checkbox
                id="roles-highlight-switches"
                data-testid="roles-highlight-switches"
                checked={highlightSwitch}
                onChange={(e) => setHighlightSwitch(e.target.checked)}
              />
              <span>Highlight Switch-Controlled ({switchCount})</span>
            </label>

            <div className="w-full sm:w-56">
              <SearchInput
                id="roles-capability-search"
                data-testid="roles-capability-search"
                aria-label="Filter capabilities"
                customPlaceholder="Filter capabilities..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 border-[#E2E8F0] py-1.5 font-sans text-xs text-[#202938] placeholder:text-[#64748B]"
              />
            </div>
          </div>
        </div>

        {/* Compact Access Scope Legend */}
        <div
          data-testid="roles-access-legend"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#E2E8F0] bg-[#F8FAFC]/60 px-4 py-2.5 font-sans text-xs text-[#64748B]"
        >
          <span className="font-medium text-[#64748B]">Access Scope Legend:</span>
          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
            <ScopeIcon kind="yes" />
            <span>Full access</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-blue-700">
            <ScopeIcon kind="own_office" />
            <span>Own office</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-teal-700">
            <ScopeIcon kind="own_records" />
            <span>Own records</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-purple-700">
            <ScopeIcon kind="read_only" />
            <span>Read only</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-[#B45309]">
            <ScopeIcon kind="switch_off" />
            <span>Switchable (On / Off)</span>
          </span>
          <span className="inline-flex items-center gap-1 font-medium text-slate-400">
            <span aria-hidden="true">&mdash;</span>
            <span>No access</span>
          </span>
        </div>

        {/* Shared CCCMS Table Component */}
        <Table
          label="Roles and permissions matrix"
          minWidth="52rem"
          className="table-fixed"
          head={
            <tr>
              <Th className="w-[38%] align-middle">
                <div>
                  <span className="block">CAPABILITY / ACTION</span>
                  <span className="mt-0.5 block font-sans text-[11px] font-normal normal-case tracking-normal text-white/75">
                    Grouped by system module
                  </span>
                </div>
              </Th>

              {matrix.roles.map((r) => {
                const meta = roleMeta(r.role);
                const count = roleCounts && typeof roleCounts[r.role] === 'number' ? roleCounts[r.role] : null;
                const isStaff = r.role === 'office_staff';
                return (
                  <Th
                    key={r.role}
                    align="center"
                    className="w-[15.5%] align-middle"
                  >
                    <div>
                      <div className="inline-flex flex-wrap items-center justify-center gap-1.5">
                        <span>{r.label}</span>
                        {isStaff && switchCount > 0 ? (
                          <span className="rounded bg-white/15 px-1.5 py-0.5 font-sans text-[10px] font-semibold normal-case tracking-normal text-gold-400">
                            {switchCount} switches
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 font-sans text-[11px] font-normal normal-case tracking-normal tabular-nums text-white/75">
                        {meta.description}
                        {count !== null ? ` · ${count.toLocaleString('en-PH')} ${count === 1 ? 'user' : 'users'}` : ''}
                      </p>
                    </div>
                  </Th>
                );
              })}
            </tr>
          }
        >
          {groups.length === 0 ? (
            <TableState
              colSpan={matrix.roles.length + 1}
              variant="search"
              title="No Matching Capabilities"
              actionLabel="Clear Search"
              onAction={() => setQuery('')}
            >
              No capabilities match &ldquo;{query.trim()}&rdquo;.
            </TableState>
          ) : (
            groups.flatMap((group) => {
              const isCollapsed = Boolean(collapsedGroups[group.name]);
              return [
                <GroupRow
                  key={`g-${group.name}`}
                  colSpan={matrix.roles.length + 1}
                  className="border-y border-[#E2E8F0] bg-[#F8FAFC] py-2.5"
                >
                  <div className="flex items-center justify-between gap-3 normal-case tracking-normal">
                    <span className="inline-flex items-center gap-2">
                      <ModuleIcon group={group.name} />
                      <span className="font-sans text-[11px] font-bold uppercase tracking-wider text-ink">
                        {group.name}
                      </span>
                      <span className="rounded border border-[#E2E8F0] bg-white px-1.5 py-0.2 font-sans text-[10px] font-bold tabular-nums text-[#64748B]">
                        {group.rows.length}
                      </span>
                    </span>

                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      data-testid={`roles-collapse-${group.name}`}
                      onClick={() => toggleGroup(group.name)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 font-sans text-xs font-medium text-[#64748B] hover:bg-white hover:text-[#202938] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
                    >
                      <span>{isCollapsed ? 'Expand' : 'Collapse'}</span>
                      <svg
                        aria-hidden="true"
                        viewBox="0 0 20 20"
                        className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m5 8 5 5 5-5" />
                      </svg>
                    </button>
                  </div>
                </GroupRow>,
                ...(isCollapsed
                  ? []
                  : group.rows.map((row) => {
                      const isSwitchRow = isSwitchControlledRow(row);
                      const linkedSwitchKey = Object.values(row.cells ?? {}).find(
                        (c) => c && typeof c === 'object' && c.switch,
                      )?.switch;
                      const switchMeta = linkedSwitchKey ? switchInfoMap.get(linkedSwitchKey) : null;

                      const rowBg = highlightSwitch
                        ? (isSwitchRow
                            ? 'bg-[#FFFBEB] hover:bg-[#FEF3C7]/60'
                            : 'bg-white opacity-55 hover:opacity-80')
                        : isSwitchRow
                          ? 'bg-white hover:bg-[#FFFBEB]/50'
                          : 'bg-white hover:bg-table-hover';

                      return (
                        <tr
                          key={row.key}
                          data-testid={`roles-row-${row.key}`}
                          data-switch-controlled={isSwitchRow ? 'true' : 'false'}
                          className={`tr-row ${rowBg}`}
                        >
                          <RowHeader
                            className={`whitespace-normal font-medium ${
                              highlightSwitch && isSwitchRow ? 'border-l-2 border-l-[#D97706]' : ''
                            }`.trim()}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="whitespace-normal leading-snug"
                                title={switchMeta?.description || undefined}
                              >
                                {row.label}
                              </span>
                              {isSwitchRow ? (
                                <span
                                  title={switchMeta?.description || 'Controlled by a configurable permission switch'}
                                  className="inline-flex shrink-0 items-center gap-1 rounded border border-[#F0DDB0] bg-[#FFFBEB] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-[#B45309]"
                                >
                                  <svg viewBox="0 0 20 20" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                                    <path d="M4 7h6M14 7h2M4 13h2M10 13h6M12 5v4M8 11v4" />
                                  </svg>
                                  <span>Switch</span>
                                </span>
                              ) : null}
                            </div>
                          </RowHeader>

                          {matrix.roles.map((r) => {
                            const cellVal = row.cells[r.role];
                            const switchGated = isSwitchCell(cellVal);
                            const switchKey = switchGated ? cellVal.switch : null;
                            const isEnabled = switchKey ? switchOn?.[switchKey] === true : false;
                            const isBusy = busySwitchKey !== null;
                            const showInteractiveSwitch = switchGated && canToggle && typeof onToggleSwitch === 'function';
                            const cellSwitchMeta = switchKey ? switchInfoMap.get(switchKey) : null;
                            const scopeBadge = isEnabled && cellSwitchMeta ? switchScopeSummary(cellSwitchMeta, offices) : null;
                            return (
                              <td
                                key={r.role}
                                className="td border-l border-[#E2E8F0] text-center align-middle"
                              >
                                {showInteractiveSwitch ? (
                                  <div className="inline-flex flex-col items-center justify-center gap-1">
                                    <button
                                      type="button"
                                      role="switch"
                                      aria-checked={isEnabled}
                                      aria-label={`Toggle ${row.label} for ${r.label} (${isEnabled ? 'On' : 'Off'})`}
                                      title={isEnabled ? `On (Yes) — click to turn off for ${r.label}` : `Off — click to turn on for ${r.label}`}
                                      data-testid={`roles-switch-${switchKey}`}
                                      disabled={isBusy}
                                      onClick={() => onToggleSwitch({ row, role: r, switchKey, nextEnabled: !isEnabled })}
                                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
                                        isEnabled ? 'bg-[#800000]' : 'bg-slate-300 hover:bg-slate-400'
                                      }`}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                          isEnabled ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                      />
                                      <span className="sr-only">
                                        {isEnabled ? 'Yes (switch on)' : 'Off (switch off)'}
                                      </span>
                                    </button>
                                    {scopeBadge ? (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        data-testid={`roles-scope-${switchKey}`}
                                        title={scopeBadge.title}
                                        onClick={() => onToggleSwitch({ row, role: r, switchKey, nextEnabled: true })}
                                        className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] font-medium text-slate-600 transition-colors hover:border-[#800000]/40 hover:bg-maroon-50 hover:text-maroon-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000] disabled:cursor-not-allowed disabled:opacity-60"
                                      >
                                        {scopeBadge.label}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : (
                                  <PermissionCellBadge cell={cellVal} switchOn={switchOn} />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })),
              ];
            })
          )}
        </Table>
      </TableShell>
    </div>
  );
}
