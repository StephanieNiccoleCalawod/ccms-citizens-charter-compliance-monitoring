import Button from './Button.js';

/**
 * The Save / Create / Update button of a modal form: the shared <Button> as a submit button. While the request is running it shows
 * the spinner and the busy label ("Saving…", "Creating…", "Updating…"), is disabled so it cannot be pressed twice, and goes back to
 * normal when the page sets busy to false (after success or failure). `form` is the id of the form it submits (the button sits in
 * the modal footer). className keeps the green Save look (btn-save) unless a page asks for another button class.
 */
export default function SubmitButton({ busy = false, label = 'Save', busyLabel = 'Saving…', form, disabled = false, className = 'btn-save' }) {
  return (
    <Button type="submit" form={form} variant={null} className={className} loading={busy} loadingLabel={busyLabel} disabled={disabled}>
      {label}
    </Button>
  );
}
