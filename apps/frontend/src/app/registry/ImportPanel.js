'use client';

import { useRef, useState } from 'react';
import ConfirmDialog from '../../components/dialogs/ConfirmDialog.js';
import StatusBanner from '../../components/feedback/StatusBanner.js';
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

function Counts({ added, updated, invalid }) {
  const items = [
    ['Added', added, 'text-emerald-700'],
    ['Updated', updated, 'text-maroon-950'],
    ['Invalid', invalid, invalid > 0 ? 'text-red-700' : 'text-slate-700'],
  ];
  return (
    <dl className="grid grid-cols-3 gap-3">
      {items.map(([label, value, tone]) => (
        <div key={label} className="rounded-xl border border-[#EAE3D9] bg-white px-4 py-3">
          <dt className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className={`mt-1 text-2xl font-bold ${tone}`}>{n(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function IssueTable({ issues }) {
  const shown = issues.slice(0, MAX_ERRORS_SHOWN);
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
      {issues.length > shown.length ? <p className="text-sm text-slate-500">Showing the first {n(shown.length)} of {n(issues.length)} problems.</p> : null}
    </div>
  );
}

/** Choose a file, Check file (dry run, writes nothing), then Import after a confirmation. All or nothing: any problem means nothing was imported. */
export default function ImportPanel({ demo, onImported }) {
  const run = useSingleSubmit();
  const inputRef = useRef(null);
  const importButtonRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
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

  const ready = canImport({ file, checkedFile: check?.file, check, busy });

  return (
    <section aria-labelledby="registry-import" className="space-y-4">
      <h2 id="registry-import" className="title-section">Import registry</h2>
      <div className="card space-y-5 p-5">
        <div>
          <label htmlFor="registry-file" className="label">Registry file (CSV or XLSX)</label>
          <p className="mb-2 text-sm text-slate-500">Up to {formatBytes(MAX_FILE_BYTES)} and {n(MAX_RECORDS)} records. Records already in the registry are updated; new ones are added.</p>
          <input
            ref={inputRef}
            id="registry-file"
            type="file"
            accept={ACCEPT_ATTRIBUTE}
            disabled={busy}
            onChange={(e) => choose(e.target.files?.[0] ?? null)}
            className="block w-full max-w-md text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-maroon-950 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
          />
          {fileError ? <p role="alert" className="mt-2 text-sm font-semibold text-red-700">{fileError}</p> : null}
        </div>

        {file ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#EAE3D9] bg-[#FBF8F3] px-4 py-3">
            <p className="text-sm text-slate-800" data-testid="registry-selected-file">
              <span className="font-semibold">{file.name}</span> <span className="text-slate-500">· {formatBytes(file.size)}</span>
            </p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy}>Replace</button>
              <button type="button" className="btn-secondary" onClick={remove} disabled={busy}>Remove</button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-secondary" onClick={runCheck} disabled={!file || busy} aria-busy={checking || undefined}>
            {checking ? 'Checking…' : 'Check file'}
          </button>
          <button ref={importButtonRef} type="button" className="btn-primary" onClick={() => setConfirmOpen(true)} disabled={!ready} aria-busy={importing || undefined}>
            {importing ? 'Importing…' : 'Import registry'}
          </button>
        </div>
        {!check && file && !busy && !result ? <p className="text-sm text-slate-500">Check the file first. Import turns on after a check with no problems.</p> : null}

        {demo ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-[#EAE3D9] pt-4 text-sm text-slate-600">
            <span className="font-semibold">Demo files:</span>
            <button type="button" className="btn-link" onClick={() => download(buildDemoValidCsv(2350), 'demo-registry-2350.csv')}>Valid registry (2,350 records)</button>
            <button type="button" className="btn-link" onClick={() => download(buildDemoInvalidCsv(), 'demo-registry-invalid-12.csv')}>Invalid QA file (12 rows)</button>
          </div>
        ) : null}
      </div>

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
    </section>
  );
}
