import StatusBanner from '../../components/feedback/StatusBanner.js';
import TableShell, { Table, Th } from '../../components/ui/TableShell.js';
import TableState from '../../components/ui/TableState.js';
import { formatDateTime } from '../../lib/ui/date-format.js';

const n = (value) => Number(value).toLocaleString('en-PH');

/** Previous imports from the service, newest first. A failed import is marked, never shown as done. */
export default function ImportHistory({ history }) {
  const { loading, items, error } = history;
  return (
    <section aria-labelledby="registry-history" className="space-y-4">
      <h2 id="registry-history" className="title-section">Import history</h2>
      {error ? <StatusBanner variant={error.unavailable ? 'warning' : 'error'} message={error.message} /> : null}
      <TableShell>
        <Table
          busy={loading}
          label="Registry import history"
          minWidth="40rem"
          head={
            <tr>
              <Th>Date &amp; time</Th>
              <Th>Imported by</Th>
              <Th align="right">Processed</Th>
              <Th align="right">Added</Th>
              <Th align="right">Updated</Th>
              <Th>Status</Th>
            </tr>
          }
        >
          {loading ? (
            <TableState colSpan={6} kind="loading">Loading history…</TableState>
          ) : error ? (
            <TableState colSpan={6} kind="error">The import history could not be loaded.</TableState>
          ) : items.length === 0 ? (
            <TableState colSpan={6}>No imports yet.</TableState>
          ) : (
            items.map((row) => (
              <tr key={row.id} className="tr-row">
                <td className="td">{formatDateTime(row.at) || '-'}</td>
                <td className="td">{row.by ?? '-'}</td>
                <td className="td text-right">{n(row.processed)}</td>
                <td className="td text-right">{n(row.added)}</td>
                <td className="td text-right">{n(row.updated)}</td>
                <td className="td">
                  {row.failed ? <span className="font-semibold text-red-700">Failed</span> : <span className="font-semibold text-emerald-700">{row.status ? row.status[0] + row.status.slice(1).toLowerCase() : 'Completed'}</span>}
                </td>
              </tr>
            ))
          )}
        </Table>
      </TableShell>
    </section>
  );
}
