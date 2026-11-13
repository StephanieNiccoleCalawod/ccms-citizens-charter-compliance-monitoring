import StatusBanner from '../../components/feedback/StatusBanner.js';
import DataTable from '../../components/ui/DataTable.js';
import { formatDateTime } from '../../lib/ui/date-format.js';

const n = (value) => Number(value).toLocaleString('en-PH');

const COLUMNS = [
  { key: 'at', header: 'Date & time', render: (row) => formatDateTime(row.at) || '-' },
  { key: 'processed', header: 'Processed', align: 'right', render: (row) => n(row.processed) },
  { key: 'added', header: 'Added', align: 'right', render: (row) => n(row.added) },
  { key: 'updated', header: 'Updated', align: 'right', render: (row) => n(row.updated) },
  { key: 'unchanged', header: 'Unchanged', align: 'right', render: (row) => n(Math.max(0, row.processed - row.added - row.updated)) },
  {
    key: 'status',
    header: 'Status',
    render: (row) =>
      row.failed ? (
        <span className="font-semibold text-red-700">Failed</span>
      ) : (
        <span className="font-semibold text-emerald-700">{row.status ? row.status[0] + row.status.slice(1).toLowerCase() : 'Completed'}</span>
      ),
  },
];

/** Previous imports from the service, newest first. A failed import is marked, never shown as done. */
export default function ImportHistory({ history }) {
  const { loading, items, error } = history;
  return (
    <section aria-labelledby="registry-history" className="space-y-4">
      <h2 id="registry-history" className="title-section">Import history</h2>
      {error ? <StatusBanner variant={error.unavailable ? 'warning' : 'error'} message={error.message} /> : null}
      <DataTable
        label="Registry import history"
        columns={COLUMNS}
        data={items}
        keyExtractor={(row) => row.id}
        loading={loading}
        loadingMessage="Loading history…"
        error={error ? 'The import history could not be loaded.' : null}
        emptyMessage="No imports yet."
        minWidth="40rem"
      />
    </section>
  );
}
