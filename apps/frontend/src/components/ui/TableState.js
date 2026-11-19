// One table row that shows a loading, empty or error message. The message text comes from the page
// (children); this only decides how it looks.
export default function TableState({ colSpan, kind = 'empty', children }) {
  const tone = kind === 'error' ? 'text-red-700' : 'text-ink-muted';
  return (
    <tr>
      <td className={`td py-6 text-center ${tone}`} colSpan={colSpan}>
        {kind === 'loading' ? (
          <span className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="h-2 w-16 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
            {children}
          </span>
        ) : (
          children
        )}
      </td>
    </tr>
  );
}
