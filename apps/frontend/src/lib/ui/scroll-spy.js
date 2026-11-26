'use client';

import { useEffect, useRef, useState } from 'react';

/** Of the ids currently visible (a map built from IntersectionObserver entries, within a band just below the
 * sticky header), the one latest in `ids` order is the active section: at the seam between two sections, both
 * can briefly be visible in that band at once (a short one, or the tail end of a long one, right at the header
 * line) - the later one is the one the reader just scrolled to, so it wins over the one on its way out. */
export function pickActiveId(ids, visibleMap) {
  for (let i = ids.length - 1; i >= 0; i -= 1) {
    if (visibleMap[ids[i]]) return ids[i];
  }
  return null;
}

/**
 * Tracks which of the given section ids (elements with a matching `id` attribute) is the one currently scrolled
 * to, for a scrollspy sidebar. `offset` is the height of anything sticky above the content (so a section counts
 * as "reached" only once it clears that header, not as soon as its top touches the real viewport edge).
 * `goTo(id)` scrolls smoothly to a section, marks it active immediately, and holds that until the scroll settles
 * so the observer does not fight the jump.
 */
export function useScrollSpy(ids, { offset = 96 } = {}) {
  const [activeId, setActiveId] = useState(ids[0] ?? null);
  const visible = useRef({});
  const suppressUntil = useRef(0);
  const idsKey = ids.join('|');

  useEffect(() => {
    if (ids.length === 0) return undefined;
    const elements = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (elements.length === 0) return undefined;
    visible.current = {};

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          visible.current[entry.target.id] = entry.isIntersecting;
        });
        if (Date.now() < suppressUntil.current) return; // a click just jumped here; let the scroll settle first
        const next = pickActiveId(ids, visible.current);
        if (next) setActiveId(next);
      },
      { rootMargin: `-${offset}px 0px -70% 0px`, threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idsKey is the stable form of ids
  }, [idsKey, offset]);

  function goTo(id) {
    const el = document.getElementById(id);
    if (!el) return;
    setActiveId(id);
    suppressUntil.current = Date.now() + 700; // roughly how long the smooth scroll takes to settle
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return { activeId, goTo };
}
