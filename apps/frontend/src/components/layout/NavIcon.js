// Small line icons for the sidebar, drawn inline like the icons on the public home page (the project
// has no icon library). Decorative: the link text is the accessible name, so they are hidden from
// assistive technology.
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
  list: <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  sliders: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />,
  dot: <circle cx="12" cy="12" r="3" />,
};

// Icon per existing route. Routes without an entry get a neutral dot.
const ICON_BY_HREF = {
  '/': 'home',
  '/office': 'grid',
  '/campus': 'grid',
  '/accounts': 'users',
  '/offices': 'building',
  '/services': 'layers',
  '/calendar': 'calendar',
  '/settings': 'sliders',
  '/logs': 'list',
  '/transactions': 'receipt',
};

export default function NavIcon({ href }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] shrink-0" aria-hidden="true" focusable="false">
      {SHAPES[ICON_BY_HREF[href] ?? 'dot']}
    </svg>
  );
}
