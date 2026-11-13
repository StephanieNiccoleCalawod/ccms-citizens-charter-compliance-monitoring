import Spinner from './Spinner.js';

/**
 * A page or section that is still loading: the spinner and a short message ("Loading the queue…"), announced politely.
 * Inside a table use <TableState kind="loading"> (DataTable does this for you). Errors use <ErrorBanner>.
 */
export default function LoadingState({ children = 'Loading…', className = '' }) {
  return (
    <p role="status" className={`inline-flex items-center gap-2 text-sm text-slate-500 ${className}`.trim()}>
      <Spinner />
      {children}
    </p>
  );
}
