import ClearFiltersButton from './ClearFiltersButton.js';

/**
 * The filter panel of a list page: the same white card, padding and wrapping across CCMS, with the shared
 * "Clear filters" button while `onClear` is given and `dirty` is true, and optional right-aligned `actions`.
 * Put each field in a <div> with a .label and an .input (selects: "input select-chevron").
 * Pass `onSubmit` to render a <form> (Enter-to-submit); pass `align="top"` when fields render inline errors
 * beneath inputs so Clear filters and action buttons remain aligned with the inputs instead of dropping down.
 */
const SPACER_VISIBILITY = {
  sm: 'hidden sm:block',
  '2xl': 'hidden 2xl:block',
};

export default function FilterBar({
  label = 'Filters',
  dirty = false,
  onClear,
  clearDisabled = false,
  actions,
  onSubmit,
  noValidate = false,
  align = 'end',
  spacerAt = 'sm',
  className = '',
  children,
  ...props
}) {
  const Tag = onSubmit ? 'form' : 'section';
  const topAligned = align === 'top';
  const rowAlign = topAligned ? 'items-start' : 'items-end';
  const labelSpacer = topAligned ? (
    <span aria-hidden="true" className={`label invisible select-none ${SPACER_VISIBILITY[spacerAt] ?? 'hidden sm:block'}`}>&nbsp;</span>
  ) : null;

  return (
    <Tag
      aria-label={label}
      onSubmit={onSubmit}
      noValidate={onSubmit ? noValidate : undefined}
      className={`card p-5 sm:p-6 ${className}`.trim()}
      {...props}
    >
      <div className={`flex flex-wrap ${rowAlign} gap-x-4 gap-y-4`}>
        {children}
        {onClear && dirty ? (
          <div className="w-full sm:w-auto">
            {labelSpacer}
            <ClearFiltersButton className="w-full sm:w-auto" disabled={clearDisabled} onClick={onClear} />
          </div>
        ) : null}
        {actions ? (
          <div className="w-full sm:ml-auto sm:w-auto">
            {labelSpacer}
            <div className="flex flex-wrap items-end gap-2">{actions}</div>
          </div>
        ) : null}
      </div>
    </Tag>
  );
}
