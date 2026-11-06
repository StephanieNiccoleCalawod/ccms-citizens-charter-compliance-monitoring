/**
 * The "Clear filters" button of every CCMS filter panel (Transactions, Accounts, Offices, Services, Audit logs, Holidays).
 * A page shows it only while at least one filter differs from its default, and its onClick puts every filter of that page back
 * to the default (search text included) and reloads from page 1. One look everywhere: an outlined maroon button.
 */
export default function ClearFiltersButton({ onClick, disabled = false, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn border border-maroon-800 bg-transparent text-maroon-800 hover:bg-maroon-50 ${className}`.trim()}
    >
      Clear filters
    </button>
  );
}
