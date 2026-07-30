const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Icon = {
  Menu: (p) => (
    <svg {...base} {...p}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  ),
  Plus: (p) => (
    <svg {...base} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  Send: (p) => (
    <svg {...base} {...p}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  ),
  Stop: (p) => (
    <svg {...base} {...p} fill="currentColor" stroke="none">
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </svg>
  ),
  Attach: (p) => (
    <svg {...base} {...p}>
      <path d="M21.4 11.1 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.7" />
    </svg>
  ),
  Search: (p) => (
    <svg {...base} {...p}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  ),
  Copy: (p) => (
    <svg {...base} {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  ),
  Check: (p) => (
    <svg {...base} {...p}>
      <path d="m5 13 4 4L19 7" />
    </svg>
  ),
  Refresh: (p) => (
    <svg {...base} {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </svg>
  ),
  Trash: (p) => (
    <svg {...base} {...p}>
      <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13h10l1-13" />
    </svg>
  ),
  Pencil: (p) => (
    <svg {...base} {...p}>
      <path d="M4 20h4L20 8l-4-4L4 16v4Z" />
      <path d="m14 6 4 4" />
    </svg>
  ),
  Sun: (p) => (
    <svg {...base} {...p}>
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </svg>
  ),
  Moon: (p) => (
    <svg {...base} {...p}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
    </svg>
  ),
  Chevron: (p) => (
    <svg {...base} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  Close: (p) => (
    <svg {...base} {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  ),
  Download: (p) => (
    <svg {...base} {...p}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" />
    </svg>
  ),
  Brain: (p) => (
    <svg {...base} {...p}>
      <path d="M9.5 4.5A2.5 2.5 0 0 1 12 7v10a2.5 2.5 0 0 1-4.6 1.3A2.5 2.5 0 0 1 4 16v-.6A2.6 2.6 0 0 1 3.5 11 2.5 2.5 0 0 1 5 7.2 2.5 2.5 0 0 1 9.5 4.5Z" />
      <path d="M14.5 4.5A2.5 2.5 0 0 0 12 7v10a2.5 2.5 0 0 0 4.6 1.3A2.5 2.5 0 0 0 20 16v-.6a2.6 2.6 0 0 0 .5-4.4A2.5 2.5 0 0 0 19 7.2 2.5 2.5 0 0 0 14.5 4.5Z" />
    </svg>
  ),
  Sparkle: (p) => (
    <svg viewBox="0 0 24 24" width={20} height={20} fill="currentColor" {...p}>
      <path d="M12 1.5c.42 3.94 2.06 6.9 4.9 8.78 1.32.88 2.9 1.43 4.6 1.72-4.02.42-7 2.12-8.9 4.9-.88 1.32-1.43 2.9-1.72 4.6-.42-4.02-2.12-7-4.9-8.9-1.3-.87-2.9-1.42-4.58-1.7 4-.43 7-2.13 8.88-4.9.87-1.32 1.42-2.9 1.72-4.5Z" />
    </svg>
  ),
  Image: (p) => (
    <svg {...base} {...p}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m4 18 5-5 4 4 3-3 4 4" />
    </svg>
  ),
  File: (p) => (
    <svg {...base} {...p}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  Link: (p) => (
    <svg {...base} {...p}>
      <path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1L11 5" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20l1-1" />
    </svg>
  ),
  Logout: (p) => (
    <svg {...base} {...p}>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 8 6 12l4 4M6 12h9" />
    </svg>
  ),
  Cloud: (p) => (
    <svg {...base} {...p}>
      <path d="M17.5 19a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6-1.4A4 4 0 0 0 7 19Z" />
    </svg>
  ),
  // Speech bubble struck through: a conversation that is not kept.
  Temporary: (p) => (
    <svg {...base} {...p}>
      <path d="M20 11.5a7.5 7.5 0 0 1-10.9 6.7L5 19.5l1.3-3.6A7.5 7.5 0 0 1 13.5 4" />
      <path d="M4 20 20 4" />
    </svg>
  ),
};
