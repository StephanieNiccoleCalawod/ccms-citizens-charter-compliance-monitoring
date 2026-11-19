'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import FilterBar from '../../components/forms/FilterBar.js';
import SearchInput from '../../components/forms/SearchInput.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import Button from '../../components/ui/Button.js';
import StatusBadge from '../../components/ui/StatusBadge.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import Tabs from '../../components/ui/Tabs.js';
import { registryFetcher, searchRegistry } from '../../lib/api/registry.js';
import { formatDate } from '../../lib/ui/date-format.js';
import {
  aggregateProgramTotals,
  filterAndSortPrograms,
  getProgramDegreeTitle,
} from '../../lib/ui/registry-import.js';
import { isSearchable } from '../../lib/ui/start-transaction.js';
import { UploadIcon } from './ImportPanel.js';

const n = (value) => Number(value ?? 0).toLocaleString('en-PH');
const DIRECTORY_DEBOUNCE_MS = 300;
const DEFAULT_PROGRAM_SORT = { key: 'program_code', direction: 'asc' };

/**
 * Registry overview:
 * 1. Single-line filter & action card (.card p-5 sm:p-6) with Search bar on the left and Import Registry button on the right
 * 2. Horizontal Tab Navigation (<Tabs variant="analytics" />) positioned outside the table card
 * 3. TableShell card containing the maroon header, rows, and summary footer
 */
export default function RegistryOverview({ summary, onImportClick }) {
  const { loading, data, error } = summary;

  const [activeTab, setActiveTab] = useState('programs'); // 'programs' | 'directory'
  const [programQuery, setProgramQuery] = useState('');

  // Directory tab state
  const [selectedProgram, setSelectedProgram] = useState('');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directoryState, setDirectoryState] = useState({
    status: 'idle', // 'idle' | 'loading' | 'ready' | 'failed'
    items: [],
    message: null,
  });

  const latestSearchRef = useRef(0);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    const timer = debounceTimerRef;
    const latest = latestSearchRef;
    return () => {
      clearTimeout(timer.current);
      latest.current += 1;
    };
  }, []);

  const totalProgramCount = data?.programs?.length ?? 0;

  const displayedPrograms = useMemo(
    () => filterAndSortPrograms(data?.programs ?? [], { query: programQuery, sort: DEFAULT_PROGRAM_SORT }),
    [data, programQuery],
  );

  const displayedTotals = useMemo(() => {
    if (!programQuery.trim() && data) {
      return {
        count: data.programs.length,
        enrolled: data.enrolled,
        alumni: data.alumni,
        total: data.total,
      };
    }
    return aggregateProgramTotals(displayedPrograms);
  }, [programQuery, data, displayedPrograms]);

  const selectedProgramRecord = useMemo(() => {
    if (!selectedProgram || !data?.programs) return null;
    const found = data.programs.find((p) => p.program_code === selectedProgram);
    if (!found) return null;
    return {
      ...found,
      degree_title: getProgramDegreeTitle(found.program_code, found.degree_title),
    };
  }, [selectedProgram, data]);

  function runDirectorySearch(text) {
    clearTimeout(debounceTimerRef.current);
    const reqId = ++latestSearchRef.current;
    if (!isSearchable(text)) {
      setDirectoryState({ status: 'idle', items: [], message: null });
      return;
    }
    setDirectoryState((prev) => ({ ...prev, status: 'loading', message: null }));
    debounceTimerRef.current = setTimeout(async () => {
      try {
        const fetcher = registryFetcher();
        const res = await searchRegistry(text.trim(), undefined, fetcher);
        if (reqId === latestSearchRef.current) {
          setDirectoryState({ status: 'ready', items: res?.items ?? [], message: null });
        }
      } catch (err) {
        if (reqId !== latestSearchRef.current) return;
        const message = err?.status === 429
          ? 'Too many searches in a minute. Please wait a moment and try again.'
          : err?.message || 'The registry directory search is not available right now.';
        setDirectoryState({ status: 'failed', items: [], message });
      }
    }, DIRECTORY_DEBOUNCE_MS);
  }

  function inspectProgram(programCode) {
    setSelectedProgram(programCode);
    setActiveTab('directory');
  }

  const directoryItems = useMemo(() => {
    const raw = directoryState.items ?? [];
    if (!selectedProgram) return raw;
    return raw.filter((item) => String(item.program ?? '').toUpperCase() === selectedProgram.toUpperCase());
  }, [directoryState.items, selectedProgram]);

  const registryTabs = [
    {
      id: 'programs',
      label: data ? `Program Summary (${n(totalProgramCount)})` : 'Program Summary',
    },
    {
      id: 'directory',
      label: 'Individual Student / Alumni Directory',
    },
  ];

  return (
    <section aria-labelledby="registry-overview" className="space-y-4">
      <h2 id="registry-overview" className="sr-only">Registry overview</h2>

      {error ? (
        <StatusBanner variant={error.unavailable ? 'warning' : 'error'} message={error.message} />
      ) : null}

      {/* 1. Single-Line Filter & Action Card (Search bar on left, Import Registry button on right) */}
      <FilterBar
        label="Registry filters"
        actions={onImportClick ? (
          <Button
            className="w-full sm:w-auto"
            leadingIcon={<UploadIcon className="h-4 w-4" />}
            onClick={onImportClick}
          >
            Import Registry
          </Button>
        ) : null}
      >
        {activeTab === 'programs' ? (
          <div className="w-full sm:w-80">
            <label className="label" htmlFor="registry-program-search">
              Search
            </label>
            <SearchInput
              id="registry-program-search"
              data-testid="registry-program-search"
              customPlaceholder="Search program code or degree..."
              value={programQuery}
              onChange={(e) => setProgramQuery(e.target.value)}
            />
          </div>
        ) : (
          <div className="w-full sm:w-80">
            <label className="label" htmlFor="registry-directory-search">
              Search
            </label>
            <SearchInput
              id="registry-directory-search"
              data-testid="registry-directory-search"
              maxLength={100}
              customPlaceholder="Student number or name (3+ letters)..."
              value={directoryQuery}
              onChange={(e) => {
                setDirectoryQuery(e.target.value);
                runDirectorySearch(e.target.value);
              }}
            />
          </div>
        )}
      </FilterBar>

      {/* 2. Horizontal Tab Navigation (Outside the Table Card) */}
      <Tabs
        variant="analytics"
        idPrefix="registry"
        label="Registry directory views"
        tabs={registryTabs}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* 3. Registry Table Card */}
      <TableShell>
        {/* Tab 1: Program Summary Table (4 Columns: Program & Degree Title [left], Enrolled [center], Alumni [center], Total [center]) */}
        {activeTab === 'programs' ? (
          <div
            role="tabpanel"
            id="registry-panel-programs"
            aria-labelledby="registry-tab-programs"
            data-testid="registry-panel-programs"
          >
            <Table
              busy={loading}
              label="Registry records by program"
              minWidth="34rem"
              className="table-fixed"
              head={
                <tr>
                  <Th className="w-[52%]">
                    Program &amp; Degree Title
                  </Th>
                  <Th align="center" className="w-[16%]">
                    Enrolled
                  </Th>
                  <Th align="center" className="w-[16%]">
                    Alumni
                  </Th>
                  <Th align="center" className="w-[16%]">
                    Total
                  </Th>
                </tr>
              }
            >
              {loading ? (
                <TableState colSpan={4} kind="loading">Loading summary…</TableState>
              ) : error ? (
                <TableState colSpan={4} kind="error">The summary could not be loaded.</TableState>
              ) : !data || data.programs.length === 0 ? (
                <TableState colSpan={4}>No registry records yet. Use Import Registry above to add some.</TableState>
              ) : displayedPrograms.length === 0 ? (
                <TableState colSpan={4}>
                  No academic programs match &ldquo;{programQuery.trim()}&rdquo;.
                </TableState>
              ) : (
                <>
                  {displayedPrograms.map((p) => (
                    <tr key={p.program_code} className="tr-row" data-testid={`program-row-${p.program_code}`}>
                      <td className="td text-left">
                        <button
                          type="button"
                          data-testid={`inspect-program-${p.program_code}`}
                          onClick={() => inspectProgram(p.program_code)}
                          className="group flex w-full cursor-pointer items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
                        >
                          <span
                            data-testid={`program-badge-${p.program_code}`}
                            className="inline-flex min-w-[3.75rem] shrink-0 items-center justify-center rounded-md border border-[#F3C5C5] bg-[#FDF2F2] px-2.5 py-1 font-sans text-xs font-bold tracking-wide text-[#800000]"
                          >
                            {p.program_code}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block whitespace-normal break-words font-sans text-sm font-semibold leading-snug text-[#202938] group-hover:text-[#800000]">
                              {p.degree_title}
                            </span>
                            <span className="mt-0.5 block font-sans text-xs text-[#64748B]">
                              Click to inspect {p.program_code} roster
                            </span>
                          </span>
                        </button>
                      </td>
                      <td className="td text-center font-sans text-sm font-medium tabular-nums text-[#202938]">
                        {n(p.enrolled)}
                      </td>
                      <td className="td text-center font-sans text-sm font-medium tabular-nums text-[#202938]">
                        {n(p.alumni)}
                      </td>
                      <td className="td text-center font-sans text-sm font-bold tabular-nums text-[#202938]">
                        {n(p.total)}
                      </td>
                    </tr>
                  ))}
                  <tr
                    className="tr-summary"
                    data-testid="registry-program-summary-footer"
                  >
                    <td className="td text-left font-sans text-sm font-bold text-ink">
                      All programs ({n(displayedTotals.count)}{' '}
                      {displayedTotals.count === 1 ? 'Academic Program' : 'Academic Programs'})
                    </td>
                    <td className="td text-center font-sans text-sm font-bold tabular-nums text-[#202938]">
                      {n(displayedTotals.enrolled)}
                    </td>
                    <td className="td text-center font-sans text-sm font-bold tabular-nums text-[#202938]">
                      {n(displayedTotals.alumni)}
                    </td>
                    <td className="td text-center font-sans text-sm font-bold tabular-nums text-[#800000]">
                      {n(displayedTotals.total)}
                    </td>
                  </tr>
                </>
              )}
            </Table>
          </div>
        ) : (
          /* Tab 2: Individual Student / Alumni Directory */
          <div
            role="tabpanel"
            id="registry-panel-directory"
            aria-labelledby="registry-tab-directory"
            data-testid="registry-panel-directory"
          >
            {selectedProgram ? (
              <div
                data-testid="registry-selected-program-banner"
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="inline-flex items-center rounded-md border border-[#F3C5C5] bg-[#FDF2F2] px-2.5 py-0.5 font-sans text-xs font-bold tracking-wide text-[#800000]">
                    {selectedProgram}
                  </span>
                  <span className="font-sans text-sm font-semibold text-[#202938]">
                    {selectedProgramRecord?.degree_title ?? getProgramDegreeTitle(selectedProgram)}
                  </span>
                  {selectedProgramRecord ? (
                    <span className="font-sans text-xs text-[#64748B]">
                      &middot; {n(selectedProgramRecord.enrolled)} Enrolled &middot; {n(selectedProgramRecord.alumni)} Alumni &middot; {n(selectedProgramRecord.total)} Total
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  data-testid="registry-clear-program-filter"
                  onClick={() => setSelectedProgram('')}
                  className="cursor-pointer font-sans text-xs font-semibold text-[#800000] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]"
                >
                  Show all programs
                </button>
              </div>
            ) : null}

            <Table
              busy={directoryState.status === 'loading'}
              label="Individual Student and Alumni Directory"
              minWidth="38rem"
              head={
                <tr>
                  <Th>
                    Student Number
                  </Th>
                  <Th>
                    Full Name
                  </Th>
                  <Th>
                    Program &amp; Degree Title
                  </Th>
                  <Th align="center">
                    Year Level
                  </Th>
                  <Th align="center">
                    Status
                  </Th>
                  <Th align="center">
                    Validity
                  </Th>
                </tr>
              }
            >
              {directoryState.status === 'loading' ? (
                <TableState colSpan={6} kind="loading">Searching directory…</TableState>
              ) : directoryState.status === 'failed' ? (
                <TableState colSpan={6} kind="error">{directoryState.message}</TableState>
              ) : directoryState.status === 'idle' ? (
                <TableState colSpan={6}>
                  {selectedProgram
                    ? `Inspecting ${selectedProgram} (${getProgramDegreeTitle(selectedProgram)}). Enter a student number or at least 3 letters of a name above to look up records.`
                    : 'Enter a complete student number or at least 3 letters of a student or alumni name above to search the directory.'}
                </TableState>
              ) : directoryItems.length === 0 ? (
                <TableState colSpan={6}>
                  {selectedProgram && directoryState.items.length > 0
                    ? `No matching records in ${selectedProgram}. Select "Show all programs" to view ${n(directoryState.items.length)} match(es) from other programs.`
                    : 'No matching student or alumni records found in the directory.'}
                </TableState>
              ) : (
                directoryItems.map((person) => (
                  <tr key={person.student_number} className="tr-row">
                    <td className="td font-sans text-sm font-semibold tabular-nums text-[#202938]">
                      {person.student_number}
                    </td>
                    <td className="td font-sans text-sm font-semibold text-[#202938]">
                      {person.full_name}
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex shrink-0 items-center rounded border border-[#F3C5C5] bg-[#FDF2F2] px-2 py-0.5 font-sans text-xs font-bold tracking-wide text-[#800000]">
                          {person.program}
                        </span>
                        <span className="whitespace-normal break-words font-sans text-xs text-[#64748B]">
                          {getProgramDegreeTitle(person.program)}
                        </span>
                      </div>
                    </td>
                    <td className="td text-center font-sans text-sm tabular-nums text-[#202938]">
                      {person.year_level ? `Year ${person.year_level}` : '—'}
                    </td>
                    <td className="td text-center">
                      <StatusBadge variant={person.status === 'ENROLLED' ? 'success' : 'neutral'}>
                        {person.status === 'ENROLLED' ? 'Enrolled' : 'Alumni'}
                      </StatusBadge>
                    </td>
                    <td className="td text-center font-sans text-xs">
                      {person.is_expired ? (
                        <span className="font-semibold text-amber-800">
                          Expired{person.valid_until ? ` (${formatDate(person.valid_until)})` : ''}
                        </span>
                      ) : person.valid_until ? (
                        <span className="text-emerald-700">
                          Valid until {formatDate(person.valid_until)}
                        </span>
                      ) : (
                        <span className="text-[#64748B]">Permanent alumni record</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </Table>
          </div>
        )}
      </TableShell>
    </section>
  );
}
