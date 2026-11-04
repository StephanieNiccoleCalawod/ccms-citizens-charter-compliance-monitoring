// Draws the tree from auditValueTree(). Every value is a React text child, so audit content is escaped and
// never run as HTML, whatever it contains.
export default function AuditValue({ node }) {
  if (node.kind === 'empty') return <span className="text-slate-400">—</span>;
  if (node.kind === 'leaf') return <span className="break-words">{node.text}</span>;
  if (node.kind === 'list') {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {node.items.map((item, index) => (
          <li key={index}>
            <AuditValue node={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="space-y-1.5">
      {node.fields.map((field) => (
        <div key={field.key} className="grid gap-x-3 sm:grid-cols-[minmax(7rem,10rem)_1fr]">
          <dt className="text-xs font-semibold text-slate-500">{field.label}</dt>
          <dd className="min-w-0 text-sm text-slate-800">
            <AuditValue node={field.node} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
