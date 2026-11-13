// Small line icons for the sidebar, drawn inline like the icons on the public home page (the project
// has no icon library). Decorative: the link text is the accessible name, so they are hidden from
// assistive technology. Every route gets its own shape (no two items in the same sidebar share one),
// chosen to suggest what the page is about rather than being a generic placeholder.
const SHAPES = {
  home: <path d="M3 11.5 12 4l9 7.5M5 10v10h5v-6h4v6h5V10" />,
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 3a7 7 0 0 1 7 7c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 7-7Z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2c2.2.7 3.5 2.7 3.5 5.8" />
    </>
  ),
  building: <path d="M4 21V4a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v17M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 7h3M8 11h3M8 15h3" />,
  layers: <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12.5l9 5 9-5M3 16.5l9 5 9-5" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </>
  ),
  bars: (
    <>
      <path d="M5 21V10M12 21V4M19 21v-7" />
      <path d="M3 21h18" />
    </>
  ),
  bubble: (
    <>
      <path d="M4 5h16v11H9l-4 4V16H4Z" />
      <path d="M12 9v3M12 13.2v.1" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.6 2.7 18a1.8 1.8 0 0 0 1.5 2.7h15.6a1.8 1.8 0 0 0 1.5-2.7L13.7 4.6a1.8 1.8 0 0 0-3.4 0Z" />
      <path d="M12 10v4M12 17.2v.1" />
    </>
  ),
  ticket: (
    <>
      <path d="M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1.3a1.5 1.5 0 0 0 0 2.9V15a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-1.8a1.5 1.5 0 0 0 0-2.9V9Z" />
      <path d="M12 8v1.2M12 11.4v1.2M12 14.8V16" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4.5" width="18" height="4" rx="1" />
      <path d="M5 8.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5" />
      <path d="M10 13h4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 4.5 6v6c0 5 3.3 8 7.5 9 4.2-1 7.5-4 7.5-9V6L12 3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 4v4h4" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />,
  dot: <circle cx="12" cy="12" r="3" />,
};

// Icon per existing route. Routes without an entry get a neutral dot.
const ICON_BY_HREF = {
  '/': 'home',
  '/office': 'grid',
  '/campus': 'pin',
  '/accounts': 'users',
  '/offices': 'building',
  '/services': 'layers',
  '/calendar': 'calendar',
  '/settings': 'sliders',
  '/settings/roles': 'shield',
  '/logs': 'history',
  '/registry': 'archive',
  '/transactions': 'receipt',
  '/late-risk': 'warning',
  '/reports': 'bars',
  '/complaints': 'bubble',
  '/queue': 'ticket',
};

export default function NavIcon({ href }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0" aria-hidden="true" focusable="false">
      {SHAPES[ICON_BY_HREF[href] ?? 'dot']}
    </svg>
  );
}
