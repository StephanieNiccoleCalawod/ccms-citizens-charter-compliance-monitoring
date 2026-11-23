// After a form is submitted and something is wrong, the focus goes to the first field to fix (S8-37, AC2). One place for every form: a form
// that marks a field invalid (aria-invalid="true", which every CCMS field does) gets it, whether the problem was found in the browser
// or came back from the server a moment later.
//
// It only reacts to a real submit, and only for a few seconds after it, inside the form or dialog that was submitted, so a field that is
// marked invalid while someone is simply typing never takes the focus away.

const INVALID = '[aria-invalid="true"]:not([disabled]):not([type="hidden"])';
// Some forms show the sentence under the field (red text) without marking the field itself; the sentence leads to its field.
const ERROR_TEXT = 'p.text-red-700, p.text-red-600';
const FIELD = 'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/** The field an error sentence is about: the field in the same block, within two levels, when that block holds at most two fields. */
function fieldOfErrorText(message) {
  let block = message.parentElement;
  for (let level = 0; level < 3 && block; level += 1, block = block.parentElement) {
    const fields = block.querySelectorAll?.(FIELD) ?? [];
    if (fields.length > 0) return fields.length <= 2 ? fields[0] : null;
  }
  return null;
}

/** The first field in `root` that is marked invalid, or the field under the first error sentence, or null. */
export function firstInvalidIn(root) {
  const marked = root?.querySelector?.(INVALID);
  if (marked) return marked;
  const message = root?.querySelector?.(ERROR_TEXT);
  return message ? fieldOfErrorText(message) : null;
}

/** What a submit belongs to: its form, else the dialog it is in, else the whole page. */
export const scopeOf = (target) => target?.closest?.('form, [role="dialog"], [role="alertdialog"]') ?? target?.ownerDocument?.body ?? null;

/** Starts listening; returns the function that stops it. `doc` is the document (a test passes a stand-in). */
export function installFocusFirstError(doc, { windowMs = 4000 } = {}) {
  const view = doc.defaultView;
  let observer = null;
  let timer = null;

  const stop = () => {
    observer?.disconnect();
    observer = null;
    if (timer !== null) view.clearTimeout(timer);
    timer = null;
  };

  const focusFirst = (scope) => {
    const field = firstInvalidIn(scope);
    if (!field) return false;
    if (doc.activeElement !== field) field.focus();
    return true;
  };

  const watch = (scope) => {
    stop();
    if (!scope) return;
    // The form's own handlers run after this one, so look once they have had the chance to mark a field, then keep watching for an answer from the server.
    view.requestAnimationFrame(() => {
      if (focusFirst(scope)) {
        stop();
        return;
      }
      observer = new view.MutationObserver(() => {
        if (focusFirst(scope)) stop();
      });
      observer.observe(scope, { attributes: true, attributeFilter: ['aria-invalid'], childList: true, subtree: true });
      timer = view.setTimeout(stop, windowMs);
    });
  };

  const onSubmit = (event) => watch(scopeOf(event.target));
  doc.addEventListener('submit', onSubmit, true);
  return () => {
    stop();
    doc.removeEventListener('submit', onSubmit, true);
  };
}
