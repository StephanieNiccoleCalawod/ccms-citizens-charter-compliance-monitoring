/**
 * Reusable CCMS status and classification pill badge: one shape, one size, and one colour per meaning everywhere.
 * `variant` is a status value as the API sends it (case does not matter: 'IN_PROGRESS', 'high', 'Resolved') or one of the
 * plain tones (success, warning, danger, info, neutral, brand). Text always comes with the colour, so meaning never relies on colour alone.
 */
const TONES = {
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-800',
  danger: 'bg-red-50 text-red-700',
  info: 'bg-blue-50 text-blue-700',
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-maroon-50 text-maroon-800',
  accent: 'bg-accent-50 text-slate-900',
};

const VARIANT_STYLES = {
  ...TONES,

  // Classification variants
  simple: 'bg-emerald-50 text-emerald-700',
  complex: 'bg-amber-50 text-amber-800',
  highly_technical: 'bg-blue-50 text-blue-700',

  // Record status variants
  active: 'bg-emerald-50 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-600',
  dissolved: 'bg-red-50 text-red-700',
  archived: 'bg-slate-100 text-slate-600',

  // Transaction status variants
  in_progress: 'bg-blue-50 text-blue-700',
  processing: TONES.info,
  on_hold: 'bg-amber-50 text-amber-800',
  completed: 'bg-emerald-50 text-emerald-700',
  approved: TONES.success,
  cancelled: 'bg-slate-100 text-slate-600',
  auto_closed: 'bg-slate-100 text-slate-600',
  rejected: 'bg-red-50 text-red-700',

  // Compliance result variants (transaction detail)
  compliant: 'bg-emerald-50 text-emerald-700',
  breach: 'bg-red-50 text-red-700',
  pending: 'bg-amber-50 text-amber-800',

  // Deadlines and late risk (Late-risk, Complaints, Insights)
  overdue: TONES.danger,
  at_risk: TONES.warning,
  high: TONES.danger,
  medium: TONES.warning,
  low: TONES.success,

  // Complaints
  received: TONES.info,
  acknowledged: TONES.warning,
  resolved: TONES.success,

  // Reports
  draft: TONES.neutral,
  published: TONES.success,
  superseded: TONES.neutral,

  // Queue lanes
  priority: TONES.warning,
  regular: TONES.neutral,

  // System role variant
  role: 'bg-maroon-50 text-maroon-800',
};

const DEFAULT_LABELS = {
  simple: 'Simple',
  complex: 'Complex',
  highly_technical: 'Highly Technical',
  active: 'Active',
  inactive: 'Inactive',
  overdue: 'Overdue',
  at_risk: 'At risk',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** The colour classes for a variant (for code that needs the same tone on something that is not a badge). */
export function statusTone(variant) {
  return VARIANT_STYLES[String(variant ?? '').toLowerCase()] || 'bg-slate-100 text-slate-700';
}

export default function StatusBadge({ variant = 'simple', children, className = '', title, ...props }) {
  const normalizedVariant = String(variant).toLowerCase();
  const colorStyle = statusTone(normalizedVariant);
  const label = children ?? DEFAULT_LABELS[normalizedVariant] ?? variant;

  return (
    <span
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold select-none ${colorStyle} ${className}`.trim()}
      {...props}
    >
      {label}
    </span>
  );
}
