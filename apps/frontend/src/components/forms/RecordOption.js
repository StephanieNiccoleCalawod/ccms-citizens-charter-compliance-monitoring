import { isSelectable, statusLabel } from '../../lib/ui/record-status.js';

/**
 * An <option> for a record that can be inactive: an inactive record stays in the list with "(Inactive)", in gray, and is really
 * disabled (the browser will not let it be chosen by mouse or keyboard).
 */
export default function RecordOption({ record, value, children }) {
  const selectable = isSelectable(record);
  return (
    <option value={value} disabled={!selectable} aria-disabled={!selectable || undefined} className={selectable ? undefined : 'text-slate-400'}>
      {statusLabel(children, record)}
    </option>
  );
}
