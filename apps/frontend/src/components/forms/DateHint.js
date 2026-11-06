// The hint under every date field: the browser's own date picker may show the date in the computer's
// format, so this says what CCMS shows everywhere else. Link it to the field with aria-describedby={id}.
export default function DateHint({ id }) {
  return (
    <p id={id} className="mt-1 text-xs text-slate-500">
      MM/DD/YYYY
    </p>
  );
}
