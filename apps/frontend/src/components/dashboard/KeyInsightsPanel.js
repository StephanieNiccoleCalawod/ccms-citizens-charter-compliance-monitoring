import Link from 'next/link';
import EmptyState from '../ui/EmptyState.js';

function ActionControl({ action, primary = false }) {
  if (!action?.href) return null;
  const isInternalPage = typeof action.href === 'string' && action.href.startsWith('/');
  const cls = primary
    ? 'inline-flex items-center rounded-lg bg-[#800000] px-3 py-1.5 font-sans text-xs font-semibold text-white shadow-2xs transition-colors hover:bg-[#4A0808]'
    : 'font-sans text-xs font-semibold text-[#800000] hover:underline';

  return isInternalPage ? (
    <Link href={action.href} className={cls}>
      {action.label}
    </Link>
  ) : (
    <a href={action.href} className={cls}>
      {action.label}
    </a>
  );
}

/** Section 4, right: deterministic compliance, expected-volume, and deadline-risk cards with authorized actions. */
export default function KeyInsightsPanel({ insights = [] }) {
  const warningCount = insights.filter((s) => s.kind !== 'positive').length;

  return (
    <section aria-labelledby="key-insights-title" className="card flex h-full flex-col min-w-0 p-5" data-testid="insights-sentences">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 id="key-insights-title" className="title-card text-[#202938]">Key Operational Insights</h3>
          <p className="mt-1 font-sans text-xs text-[#64748B] sm:text-sm">
            Automatically detected findings that need your attention.
          </p>
        </div>
        <span
          data-testid="key-insights-badge"
          className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 font-sans text-xs font-bold tabular-nums ${
            warningCount > 0
              ? 'border border-[#F0DDB0] bg-[#FEF3C7] text-[#78350F]'
              : 'border border-[#E2E8F0] bg-[#F4F5F8] text-[#64748B]'
          }`}
        >
          {warningCount} {warningCount === 1 ? 'Warning' : 'Warnings'}
        </span>
      </div>

      {insights.length === 0 ? (
        <EmptyState
          role="status"
          surface="subtle"
          size="compact"
          variant="success"
          title="No Operational Warnings"
          data-testid="insights-sentences-empty"
          className="mt-4 flex flex-1"
        >
          No compliance, volume, or deadline-risk warnings require attention right now.
        </EmptyState>
      ) : (
        <ul className="mt-4 flex-1 space-y-3">
          {insights.map((s) => {
            const isSlaBreach = s.template === 6;
            const isPositive = s.kind === 'positive';
            const primaryAction = s.primaryAction ?? (s.href ? { href: s.href, label: s.linkLabel ?? 'See details' } : null);

            if (isSlaBreach) {
              return (
                <li
                  key={s.id}
                  data-testid="insight-card-sla"
                  className="rounded-lg border border-l-4 border-[#E2E8F0] border-l-[#800000] bg-white p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#F3C5C5] bg-white text-[#800000]">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                        <path d="M12 9v4M12 17h.01" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block font-sans text-[11px] font-bold uppercase tracking-wider text-[#800000]">
                        {s.eyebrow || 'Deadline Risk Warning'}
                      </span>
                      <p className="mt-0.5 font-sans text-sm font-bold text-[#202938]">{s.text}</p>
                      {s.detail ? (
                        <p className="mt-1 font-sans text-xs leading-relaxed text-[#64748B]">{s.detail}</p>
                      ) : null}
                      {primaryAction || s.secondaryAction ? (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <ActionControl action={primaryAction} primary />
                          <ActionControl action={s.secondaryAction} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            }

            return (
              <li
                key={s.id}
                data-testid={`insight-card-${s.kind || 'attention'}`}
                className={`rounded-lg border border-l-4 bg-white p-3.5 ${
                  isPositive
                    ? 'border-[#E2E8F0] border-l-emerald-500'
                    : 'border-[#E2E8F0] border-l-amber-400'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                      isPositive
                        ? 'border-emerald-200 bg-white text-emerald-700'
                        : 'border-[#F0DDB0] bg-[#FEF3C7] text-[#78350F]'
                    }`}
                  >
                    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      {isPositive ? (
                        <path d="M5 12l4 4 10-10" />
                      ) : (
                        <>
                          <path d="M23 6l-9.5 9.5-5-5L1 18" />
                          <path d="M17 6h6v6" />
                        </>
                      )}
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <span
                      className={`block font-sans text-[11px] font-bold uppercase tracking-wide ${
                        isPositive ? 'text-emerald-700' : 'text-[#78350F]'
                      }`}
                    >
                      {s.eyebrow || (isPositive ? 'Positive Finding' : 'Needs Attention')}
                    </span>
                    <p className="mt-0.5 font-sans text-xs font-bold text-[#202938] sm:text-sm">{s.text}</p>
                    {s.detail ? (
                      <p className="mt-0.5 font-sans text-xs leading-relaxed text-[#64748B]">{s.detail}</p>
                    ) : null}
                    {primaryAction ? (
                      <div className="mt-2">
                        <ActionControl action={primaryAction} />
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
