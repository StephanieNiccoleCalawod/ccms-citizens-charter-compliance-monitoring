'use client';

import { useRef, useState } from 'react';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import Modal from '../../components/modals/Modal.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
import Button from '../../components/ui/Button.js';
import IconButton from '../../components/ui/IconButton.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import { buildDemoInvalidCsv, buildDemoValidCsv } from '../../lib/api/registry-demo.js';
import { checkRegistryFile, importRegistry, registryFetcher } from '../../lib/api/registry.js';
import { notify } from '../../lib/ui/notify.js';
import {
  ACCEPT_ATTRIBUTE,
  MAX_ERRORS_SHOWN,
  MAX_FILE_BYTES,
  MAX_RECORDS,
  canImport,
  describeFailure,
  formatBytes,
  normalizeCheck,
  normalizeImportResult,
  validateRegistryFile,
} from '../../lib/ui/registry-import.js';
import { useSingleSubmit } from '../../lib/ui/useSingleSubmit.js';

const n = (value) => Number(value).toLocaleString('en-PH');

/** The dropzone's own glyph, and the one on the "Import Registry" button (RegistryOverview.js reuses it). */
export function UploadIcon({ className = 'h-5 w-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V4M8 8l4-4 4 4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

function Counts({ added, updated, invalid }) {
  const items = [
    ['Added', added, 'text-emerald-700'],
    ['Updated', updated, 'text-maroon-950'],
    ['Invalid', invalid, invalid > 0 ? 'text-red-700' : 'text-slate-700'],
  ];
  return (
    <dl className="grid grid-cols-3 gap-3">
      {items.map(([label, value, tone]) => (
        <div key={label} className="rounded-card border border-line bg-white px-4 py-3">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className={`mt-1 text-2xl font-bold tabular-nums ${tone}`}>{n(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function IssueTable({ issues }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(issues.length / MAX_ERRORS_SHOWN));
  const currentPage = Math.min(page, pageCount - 1);
  const offset = currentPage * MAX_ERRORS_SHOWN;
  const shown = issues.slice(offset, offset + MAX_ERRORS_SHOWN);
  return (
    <div className="space-y-2">
      <div className="max-h-80 overflow-y-auto rounded-2xl">
        <TableShell>
          <Table
            label="Validation errors"
            minWidth="24rem"
            head={
              <tr>
                <Th className="w-24">Row</Th>
                <Th>Reason</Th>
              </tr>
            }
          >
            {shown.map((issue, index) => (
              <tr key={`${issue.row}-${index}`} className="tr-row">
                <td className="td font-semibold text-slate-900">{issue.row ?? '-'}</td>
                <td className="td">{issue.message}</td>
              </tr>
            ))}
          </Table>
        </TableShell>
      </div>
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500" aria-live="polite">
            Showing {n(offset + 1)}–{n(offset + shown.length)} of {n(issues.length)} problems.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 0}>Previous</button>
            <button type="button" className="btn-secondary" onClick={() => setPage(currentPage + 1)} disabled={currentPage + 1 === pageCount}>Next</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Choose a file, Check file (dry run, writes nothing), then Import after a confirmation. All or nothing: any problem means
 * nothing was imported. Opens as a modal from the "Import Registry" button next to the Registry overview heading.
 */
export default function ImportPanel({ open, onClose, demo, onImported }) {
  const run = useSingleSubmit();
  const inputRef = useRef(null);
  const importButtonRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [check, setCheck] = useState(null); // { file, ...normalizeCheck }
  const [failure, setFailure] = useState(null); // { message, issues, kind: 'check' | 'import' }
  const [result, setResult] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const busy = checking || importing;

  function reset(nextFile) {
    setFile(nextFile);
    setFileError(null);
    setCheck(null);
    setFailure(null);
    setResult(null);
    setConfirmOpen(false);
  }

  async function choose(chosen) {
    if (!chosen) return;
    let text;
    // A CSV is read here only to count its rows against the limit; an XLSX is counted by the service.
    if (/\.csv$/i.test(chosen.name) && chosen.size > 0 && chosen.size <= MAX_FILE_BYTES) {
      try {
        text = await chosen.text();
      } catch {
        text = undefined;
      }
    }
    const verdict = validateRegistryFile(chosen, text);
    if (!verdict.ok) {
      reset(null);
      setFileError(verdict.message);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    reset(chosen);
  }

  function remove() {
    reset(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const runCheck = () =>
    run(async () => {
      if (!file) return;
      setChecking(true);
      setFailure(null);
      setResult(null);
      setCheck(null);
      try {
        const answer = await checkRegistryFile(file, registryFetcher());
        setCheck({ file, ...normalizeCheck(answer) });
      } catch (error) {
        setFailure({ ...describeFailure(error), kind: 'check' });
      } finally {
        setChecking(false);
      }
    });

  const runImport = () =>
    run(async () => {
      if (!canImport({ file, checkedFile: check?.file, check, busy: false })) return;
      setImporting(true);
      setFailure(null);
      try {
        const answer = await importRegistry(file, { dryRun: false }, registryFetcher());
        const outcome = normalizeImportResult(answer);
        // Success only when the service reported no problems; anything else is a failure and nothing was imported.
        if (!outcome.ok) {
          setFailure({ message: 'The import did not complete. Nothing was imported.', issues: outcome.errors, kind: 'import' });
        } else {
          setResult(outcome);
          setCheck(null);
          notify.success(`Registry imported: ${n(outcome.added)} added, ${n(outcome.updated)} updated.`);
          onImported?.();
        }
      } catch (error) {
        const failed = describeFailure(error);
        setFailure({ ...failed, message: failed.unavailable ? failed.message : `${failed.message} Nothing was imported.`, kind: 'import' });
      } finally {
        setImporting(false);
        setConfirmOpen(false);
      }
    });

  function download(csv, name) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }

  function onDrop(event) {
    event.preventDefault();
    setDragOver(false);
    if (busy) return;
    choose(event.dataTransfer.files?.[0] ?? null);
  }

  const ready = canImport({ file, checkedFile: check?.file, check, busy });

  // Never close while a check or an import is running: the person could lose track of whether it went through.
  function requestClose() {
    if (busy) return;
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={busy ? undefined : requestClose}
      title="Import Student and Alumni Registry"
      showClose
      widthClass="max-w-xl"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={requestClose} disabled={busy}>{result ? 'Close' : 'Cancel'}</button>
          <button type="button" className="btn-secondary" onClick={runCheck} disabled={!file || busy} aria-busy={checking || undefined}>
            {checking ? 'Checking…' : 'Check file'}
          </button>
          <button ref={importButtonRef} type="button" className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={!ready} aria-busy={importing || undefined}>
            {importing ? 'Importing…' : 'Import registry'}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <p className="text-sm text-slate-600">Upload a CSV or XLSX file to import student and alumni records into the registry.</p>

        <label htmlFor="registry-file" className="sr-only">Registry file (CSV or XLSX)</label>
        <input
          ref={inputRef}
          id="registry-file"
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          disabled={busy}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
          className="sr-only"
        />

        {!file ? (
          <div
            onDragOver={(e) => { e.preventDefault(); if (!busy) setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            className={`rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${dragOver ? 'border-pup-maroon bg-maroon-50' : 'border-line bg-surface-muted'}`}
          >
            <UploadIcon className="mx-auto h-10 w-10 text-slate-400" />
            <p className="mt-3 font-semibold text-slate-900">Upload your file</p>
            <p className="mt-1 text-sm text-slate-600">Drag and drop your file here</p>
            <p className="my-2 text-xs font-semibold uppercase tracking-wide text-slate-400">or</p>
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={busy}>Browse Files</Button>
            <p className="mt-3 text-xs text-slate-500">CSV or XLSX &bull; Maximum {formatBytes(MAX_FILE_BYTES)} &bull; Up to {n(MAX_RECORDS)} records</p>
          </div>
        ) : null}
        {fileError ? <p role="alert" className="text-sm font-semibold text-red-700">{fileError}</p> : null}

        {file ? (
          <div>
            <p className="label">Selected file</p>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-muted px-4 py-3">
              <p className="min-w-0 truncate text-sm text-slate-800" data-testid="registry-selected-file">
                <span className="font-semibold">{file.name}</span> <span className="text-slate-500">&bull; {formatBytes(file.size)}</span>
              </p>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" className="btn-link text-xs" onClick={() => inputRef.current?.click()} disabled={busy} aria-label="Replace the selected file">Replace</button>
                <IconButton label="Remove the selected file" onClick={remove} disabled={busy}>
                  <XIcon />
                </IconButton>
              </div>
            </div>
          </div>
        ) : null}

        {!check && file && !busy && !result ? <p className="text-sm text-slate-500">Check the file first. Import turns on after a check with no problems.</p> : null}

        {demo ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm text-slate-600">
            <span className="font-semibold">Demo files:</span>
            <button type="button" className="btn-link" onClick={() => download(buildDemoValidCsv(2350), 'demo-registry-2350.csv')}>Valid registry (2,350 records)</button>
            <button type="button" className="btn-link" onClick={() => download(buildDemoInvalidCsv(), 'demo-registry-invalid-12.csv')}>Invalid QA file (12 rows)</button>
          </div>
        ) : null}

        {failure ? (
          <div className="space-y-3" data-testid="registry-failure">
            <StatusBanner variant={failure.unavailable ? 'warning' : 'error'} message={failure.message} />
            {failure.issues.length > 0 ? <IssueTable issues={failure.issues} /> : null}
          </div>
        ) : null}

        {check ? (
          <div className="space-y-3" data-testid="registry-check-result">
            {check.valid ? (
              <StatusBanner variant="success" message="The file passed the check. Nothing has been imported yet." />
            ) : (
              <StatusBanner variant="error" message={`The file has ${n(check.invalid)} invalid ${check.invalid === 1 ? 'row' : 'rows'}. Fix them and check again. Nothing can be imported until the file is clean.`} />
            )}
            <Counts added={check.added} updated={check.updated} invalid={check.invalid} />
            {check.errors.length > 0 ? <IssueTable issues={check.errors} /> : null}
          </div>
        ) : null}

        {result ? (
          <div className="space-y-3" data-testid="registry-import-result">
            <StatusBanner variant="success" message={`Import complete: ${n(result.processed)} records processed.`} />
            <Counts added={result.added} updated={result.updated} invalid={0} />
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Import registry"
        message={`Import ${file?.name ?? 'this file'}? ${check ? `${n(check.added)} records will be added and ${n(check.updated)} updated. ` : ''}This changes the registry and is recorded in the import history.`}
        confirmLabel="Import"
        busy={importing}
        busyLabel="Importing…"
        onConfirm={runImport}
        onCancel={() => setConfirmOpen(false)}
        returnFocusRef={importButtonRef}
      />
    </Modal>
  );
}
