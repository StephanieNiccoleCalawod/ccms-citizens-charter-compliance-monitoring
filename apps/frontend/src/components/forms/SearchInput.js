/**
 * The search box of every CCMS filter panel: a magnifying glass inside the left of the field and the placeholder "Search...".
 * It is an ordinary text input, so everything a page already passes (id, value, onChange, onBlur, maxLength, aria-*) goes straight
 * to it; the page keeps its own label, debounce and request. The left padding keeps the text clear of the icon.
 */
export default function SearchInput({ className = '', ...props }) {
  return (
    <div className="relative">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input type="text" autoComplete="off" {...props} placeholder="Search..." className={`input pl-9 ${className}`.trim()} />
    </div>
  );
}
