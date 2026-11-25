// Deleting a notification: ask first, then say it is done (or that it failed). Uses the one result dialog of CCMS (notify.result).
import { notify } from './notify.js';

export const DELETE_TITLE = 'Delete notification';
export const deleteQuestion = (count = 1) => (count === 1
  ? 'Are you sure you want to delete this notification? You will not see it again.'
  : `Are you sure you want to delete these ${count} notifications? You will not see them again.`);
export const deletedMessage = (count = 1) => (count === 1 ? 'The notification was deleted.' : `${count} notifications were deleted.`);
export const NOT_DELETED = 'The notification could not be deleted. Please try again.';

/** Opens "Are you sure?"; only on Delete does it call run() (which must throw when the server did not confirm), then shows Success or Failed. */
export function confirmDelete({ count = 1, run }) {
  return notify.result({
    variant: 'confirm', title: DELETE_TITLE, message: deleteQuestion(count), confirmLabel: 'Delete', cancelLabel: 'Cancel',
    onConfirm: async () => {
      try {
        await run();
      } catch {
        notify.result({ variant: 'error', title: 'Not deleted', message: NOT_DELETED });
        return;
      }
      notify.result({ variant: 'success', title: 'Deleted', message: deletedMessage(count) });
    },
  });
}
