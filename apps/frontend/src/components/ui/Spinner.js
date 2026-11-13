/** The one busy indicator of CCMS (buttons, inline loading). Decorative: the caller says what is happening in text. */
export default function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`animate-spin motion-reduce:animate-none ${className}`.trim()} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="10" cy="10" r="7" opacity="0.25" />
      <path d="M17 10a7 7 0 0 0-7-7" />
    </svg>
  );
}
