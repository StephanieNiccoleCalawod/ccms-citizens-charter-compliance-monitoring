/**
 * The heading block at the top of every signed-in page (AppShell renders it from its title / subtitle / eyebrow / headerRight
 * props): optional eyebrow, the serif page title, a one-line description, and the page's actions on the right (they wrap below
 * the title on a phone). The breadcrumb, when a page has one, sits in the top bar (see AppShell).
 */
export default function PageHeader({ title, description, eyebrow, actions, titleClassName, descriptionClassName }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className={titleClassName ?? 'title-page'}>{title}</h1>
        {description ? <p className={descriptionClassName ?? 'mt-1 text-sm text-slate-600'}>{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
