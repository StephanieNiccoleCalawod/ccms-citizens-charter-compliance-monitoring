import { ROLE_LABELS } from 'ccms-shared/roles';
import { roleBadgeClasses } from '../../lib/ui/role-style.js';

/** The role as a coloured pill. Pass the role value (for example "office_head"); the label comes from the shared role list. */
export default function RoleBadge({ role, className = '' }) {
  return (
    <span className={`inline-flex items-center justify-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-center text-xs font-semibold select-none ${roleBadgeClasses(role)} ${className}`.trim()} data-role={role}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}
