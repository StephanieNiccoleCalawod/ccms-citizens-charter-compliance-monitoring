import { useId } from 'react';

/**
 * The white CCMS card (the `card` utility: 12px radius, hairline border, soft shadow) with an optional standard header and footer.
 *   <Card title="Called" description="Tickets being served now." actions={<Button size="sm">Call next</Button>}>…</Card>
 * With a title it renders a <section> labelled by that title, so each card is a landmark screen readers can jump to.
 * padding: 'md' (20px, default), 'lg' (24px) or 'none' (the children lay out their own, e.g. a table).
 */
const PADDING = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' };

export default function Card({ title, description, actions, footer, padding = 'md', as, className = '', titleAs: Heading = 'h2', children, ...props }) {
  const titleId = useId();
  const Tag = as ?? (title ? 'section' : 'div');
  const pad = PADDING[padding] ?? PADDING.md;
  const hasHeader = Boolean(title || actions);
  return (
    <Tag aria-labelledby={title ? titleId : undefined} className={`card ${pad} ${className}`.trim()} {...props}>
      {hasHeader ? (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? (
              <Heading id={titleId} className="title-card">
                {title}
              </Heading>
            ) : null}
            {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">{footer}</div> : null}
    </Tag>
  );
}
