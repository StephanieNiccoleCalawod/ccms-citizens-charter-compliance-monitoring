import EmptyState from './EmptyState.js';

// One table row that shows a loading, empty or error state inside a <tbody>.
// Loading and error states remain strictly separated from genuine empty states.
export default function TableState({
  colSpan,
  kind = 'empty',
  variant = 'neutral',
  icon,
  title,
  description,
  supportingInfo = null,
  action = null,
  actionLabel = null,
  onAction = null,
  actionHref = null,
  actionVariant = 'secondary',
  children,
}) {
  if (kind === 'loading') {
    return (
      <tr>
        <td className="td py-6 text-center text-ink-muted" colSpan={colSpan}>
          <span className="inline-flex items-center gap-3">
            <span aria-hidden="true" className="h-2 w-16 animate-pulse rounded-full bg-line motion-reduce:animate-none" />
            {children}
          </span>
        </td>
      </tr>
    );
  }

  if (kind === 'error') {
    return (
      <tr>
        <td className="td py-8 text-center text-red-700" colSpan={colSpan}>
          {children}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="px-6 py-10 text-center align-middle" colSpan={colSpan}>
        <EmptyState
          surface="plain"
          size="compact"
          variant={variant}
          icon={icon}
          title={title}
          description={description}
          supportingInfo={supportingInfo}
          action={action}
          actionLabel={actionLabel}
          onAction={onAction}
          actionHref={actionHref}
          actionVariant={actionVariant}
        >
          {children}
        </EmptyState>
      </td>
    </tr>
  );
}
