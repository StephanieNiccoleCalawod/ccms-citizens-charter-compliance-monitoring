// One table row that shows a loading, empty or error message. The message text comes from the page
// (children); this only decides how it looks.
export default function TableState({ colSpan, kind = 'empty', children }) {
  const tone = kind === 'error' ? 'text-red-700' : 'text-slate-500';
  return (
    <tr>
      <td className={`td text-center ${tone}`} colSpan={colSpan}>
        {kind === 'loading' ? (
          <span className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="h-2 w-16 animate-pulse rounded-full bg-slate-200" />
            {children}
          </span>
        ) : (
          children
        )}
      </td>
    </tr>
  );
}
