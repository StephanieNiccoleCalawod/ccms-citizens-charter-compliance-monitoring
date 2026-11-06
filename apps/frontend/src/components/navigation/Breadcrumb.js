import Link from 'next/link';

/** Compact page path for signed-in subpages (charcoal text; the current page is the darker, heavier one). */
export default function Breadcrumb({ items, className = 'text-sm text-slate-800' }) {
  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className="flex flex-wrap items-center gap-2">
        {items.map((item, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="inline-flex items-center gap-2">
              {index > 0 ? <span aria-hidden="true" className="text-slate-500">&gt;</span> : null}
              {current || !item.href ? (
                <span aria-current={current ? 'page' : undefined} className={current ? 'font-semibold text-slate-900' : undefined}>
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} className="rounded-sm text-slate-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-maroon-700">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
