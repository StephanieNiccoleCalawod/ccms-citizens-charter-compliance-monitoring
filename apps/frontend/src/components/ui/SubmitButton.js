/**
 * The Save / Create / Update button of a modal form. While the request is running it shows a spinner and the busy label
 * ("Saving…", "Creating…", "Updating…"), is disabled so it cannot be pressed twice, and goes back to normal when the page sets
 * busy to false (after success or failure). `form` is the id of the form it submits (the button sits in the modal footer).
 */
export default function SubmitButton({ busy = false, label = 'Save', busyLabel = 'Saving…', form, disabled = false, className = 'btn-primary' }) {
  return (
    <button type="submit" form={form} className={className} disabled={busy || disabled} aria-busy={busy || undefined}>
      {busy ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 animate-spin" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
          <circle cx="10" cy="10" r="7" opacity="0.25" />
          <path d="M17 10a7 7 0 0 0-7-7" />
        </svg>
      ) : null}
      {busy ? busyLabel : label}
    </button>
  );
}
