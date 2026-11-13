import ClearFiltersButton from './ClearFiltersButton.js';

/**
 * The filter panel of a list page: the same white card, padding and wrapping as the admin filter panels (Accounts, Offices,
 * Services, Logs, Transactions, Holidays), with the shared "Clear filters" button at the end while `onClear` is given and
 * `dirty` is true. Put each field in a <div> with a .label and an .input (selects: "input select-chevron").
 *   <FilterBar label="Complaint filters" dirty={changed} onClear={reset} actions={<Button>Export</Button>}>…fields…</FilterBar>
 * `actions` sit at the far right (a page's primary action for the list, e.g. Retrain); they wrap below on a phone.
 */
export default function FilterBar({ label = 'Filters', dirty = false, onClear, actions, className = '', children, ...props }) {
  return (
    <section aria-label={label} className={`card p-5 sm:p-6 ${className}`.trim()} {...props}>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-4">
        {children}
        {onClear && dirty ? <ClearFiltersButton onClick={onClear} /> : null}
        {actions ? <div className="ml-auto flex flex-wrap items-end gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
