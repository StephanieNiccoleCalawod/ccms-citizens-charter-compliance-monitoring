import StatusBanner from '../../components/feedback/StatusBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import StatCard from '../../components/ui/StatCard.js';
import Button from '../../components/ui/Button.js';
import { UploadIcon } from './ImportPanel.js';

const n = (value) => Number(value).toLocaleString('en-PH');

function Stat({ label, value, loading }) {
  return (
    <StatCard
      label={label}
      testId={`registry-${label.toLowerCase().replaceAll(' ', '-')}`}
      value={loading ? <span aria-hidden="true" className="inline-block h-7 w-20 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" /> : value}
    />
  );
}

/** Registry overview and summary: totals, ENROLLED and ALUMNI, and the same by program code. */
export default function RegistryOverview({ summary, onImportClick }) {
  const { loading, data, error } = summary;
  return (
    <section aria-labelledby="registry-overview" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="registry-overview" className="title-section">Registry overview</h2>
        {onImportClick ? (
          <Button leadingIcon={<UploadIcon className="h-4 w-4" />} onClick={onImportClick}>Import Registry</Button>
        ) : null}
      </div>
      {error ? <StatusBanner variant={error.unavailable ? 'warning' : 'error'} message={error.message} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total records" value={data ? n(data.total) : '—'} loading={loading} />
        <Stat label="Enrolled students" value={data ? n(data.enrolled) : '—'} loading={loading} />
        <Stat label="Alumni" value={data ? n(data.alumni) : '—'} loading={loading} />
      </div>
      <TableShell>
        <Table
          busy={loading}
          label="Registry records by program"
          minWidth="28rem"
          head={
            <tr>
              <Th>Program code</Th>
              <Th align="right">Enrolled</Th>
              <Th align="right">Alumni</Th>
              <Th align="right">Total</Th>
            </tr>
          }
        >
          {loading ? (
            <TableState colSpan={4} kind="loading">Loading summary…</TableState>
          ) : error ? (
            <TableState colSpan={4} kind="error">The summary could not be loaded.</TableState>
          ) : !data || data.programs.length === 0 ? (
            <TableState colSpan={4}>No registry records yet. Use Import Registry above to add some.</TableState>
          ) : (
            <>
              {data.programs.map((p) => (
                <tr key={p.program_code} className="tr-row">
                  <td className="td font-semibold text-slate-900">{p.program_code}</td>
                  <td className="td text-right">{n(p.enrolled)}</td>
                  <td className="td text-right">{n(p.alumni)}</td>
                  <td className="td text-right font-semibold">{n(p.total)}</td>
                </tr>
              ))}
              <tr className="tr-row">
                <td className="td font-bold text-maroon-950">All programs</td>
                <td className="td text-right font-bold">{n(data.enrolled)}</td>
                <td className="td text-right font-bold">{n(data.alumni)}</td>
                <td className="td text-right font-bold">{n(data.total)}</td>
              </tr>
            </>
          )}
        </Table>
      </TableShell>
    </section>
  );
}
