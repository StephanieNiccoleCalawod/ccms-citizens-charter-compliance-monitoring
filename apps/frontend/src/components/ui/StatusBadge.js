'use client';

/**
 * Reusable CCMS status and classification pill badge.
 * Matches the official CCMS design language and government charter specifications.
 * Supported variants map directly to CCMS enum definitions.
 */
const VARIANT_STYLES = {
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
  on_hold: 'bg-amber-50 text-amber-800',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-600',
  auto_closed: 'bg-slate-100 text-slate-600',
  rejected: 'bg-red-50 text-red-700',

  // Compliance result variants (transaction detail)
  compliant: 'bg-emerald-50 text-emerald-700',
  breach: 'bg-red-50 text-red-700',
  pending: 'bg-amber-50 text-amber-800',

  // System role variant
  role: 'bg-maroon-50 text-maroon-800',
};

const DEFAULT_LABELS = {
  simple: 'Simple',
  complex: 'Complex',
  highly_technical: 'Highly Technical',
  active: 'Active',
  inactive: 'Inactive',
};

export default function StatusBadge({ variant = 'simple', children, className = '' }) {
  const normalizedVariant = String(variant).toLowerCase();
  const colorStyle = VARIANT_STYLES[normalizedVariant] || 'bg-slate-100 text-slate-700';
  const label = children ?? DEFAULT_LABELS[normalizedVariant] ?? variant;

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold select-none ${colorStyle} ${className}`.trim()}
    >
      {label}
    </span>
  );
}
