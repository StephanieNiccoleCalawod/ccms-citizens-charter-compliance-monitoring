'use client';

import { useCallback, useState } from 'react';
import { isAnyDirty } from '../ui/dirty-registry.js';
import { signOut } from './session.js';
import { SIGN_OUT_COPY, createSignOutFlow } from './sign-out-flow.js';

/**
 * Everything the Sign out button needs: open a confirmation (warning about unsaved changes), keep it
 * busy while signing out and ignore repeated clicks. Pass the button's ref to the dialog as
 * returnFocusRef so focus goes back to it on cancel.
 *
 *   const buttonRef = useRef(null);
 *   const signOutControl = useSignOut();
 *   <button ref={buttonRef} onClick={signOutControl.request}>Sign out</button>
 *   <ConfirmDialog {...signOutControl.dialogProps} returnFocusRef={buttonRef} />
 */
export function useSignOut({ execute = signOut, isDirty = isAnyDirty } = {}) {
  const [state, setState] = useState({ open: false, busy: false, dirty: false });
  // One flow per mounted button: it owns the busy flag that blocks a second sign-out request.
  const [flow] = useState(() => createSignOutFlow({ execute, isDirty, onChange: setState }));

  const request = useCallback(() => {
    flow.request();
  }, [flow]);
  const cancel = useCallback(() => {
    flow.cancel();
  }, [flow]);
  const confirm = useCallback(() => {
    flow.confirm();
  }, [flow]);

  return {
    ...state,
    request,
    cancel,
    confirm,
    dialogProps: {
      open: state.open,
      title: SIGN_OUT_COPY.title,
      message: state.dirty ? SIGN_OUT_COPY.dirtyMessage : SIGN_OUT_COPY.message,
      confirmLabel: SIGN_OUT_COPY.confirmLabel,
      danger: state.dirty,
      busy: state.busy,
      busyLabel: 'Signing out…',
      onConfirm: confirm,
      onCancel: cancel,
    },
  };
}
