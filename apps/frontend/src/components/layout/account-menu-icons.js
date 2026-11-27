// The three icons shared by the two account dropdown menus (AppShell's main header and AccountShell's Settings
// header - same menu, same three destinations, in two shells) so both stay visually identical in one place.

// Same shape as NavIcon's 'sliders' glyph, so the Settings item reads as the same destination it used to be
// in the sidebar.
export const SETTINGS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true" focusable="false">
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9M13 4v6M7 14v6" />
  </svg>
);

export const MY_ACCOUNT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true" focusable="false">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" />
  </svg>
);

export const SIGN_OUT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true" focusable="false">
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 8l-4 4 4 4" />
    <path d="M14 12H4" />
  </svg>
);
