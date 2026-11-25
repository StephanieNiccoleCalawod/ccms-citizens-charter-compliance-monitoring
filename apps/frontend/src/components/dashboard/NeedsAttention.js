'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getNotificationFeeds } from '../../lib/api/notifications.js';
import { ATTENTION_EMPTY, attentionItems, canSeeAttention, mergeNotifications } from '../../lib/ui/notifications.js';

/** S8-50: what needs the Office Head's (or Super Admin's) attention today, one sentence and one action each. */
export default function NeedsAttention({ role }) {
  const [items, setItems] = useState(null);
  const allowed = canSeeAttention(role);
  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    getNotificationFeeds().then((feeds) => { if (active) setItems(attentionItems(mergeNotifications(feeds).items, role)); });
    return () => { active = false; };
  }, [allowed, role]);
  if (!allowed || items === null) return null;
  return (
    <section className="card p-4" aria-labelledby="needs-attention-heading" data-testid="needs-attention">
      <h2 id="needs-attention-heading" className="text-base font-semibold text-slate-900">Needs attention</h2>
      {items.length === 0 ? <p className="mt-1 text-sm text-slate-500">{ATTENTION_EMPTY}</p> : (
        <ul className="mt-2 divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <p className="text-sm text-slate-800">{i.text}</p>
              <Link href={i.href} className="btn-secondary">{i.action}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
