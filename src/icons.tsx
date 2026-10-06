const PATHS: Record<string, string> = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  alert: 'M12 8v5m0 3.5v.01M10.3 3.9L2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z',
  calendar: 'M7 3v3m10-3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
  clock: 'M12 7v5l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  minus: 'M6 12h12',
  upload: 'M12 16V4m0 0L7 9m5-5l5 5M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zm0 0v5h5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  refresh: 'M20 11a8 8 0 0 0-14.9-3M4 4v4h4m-4 5a8 8 0 0 0 14.9 3M20 20v-4h-4',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zm7 12l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  download: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
  copy: 'M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.700l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1',
  chevron: 'M9 6l6 6-6 6',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  stamp: 'M9 3h6v3a3 3 0 0 0 1 2.200l1 .9a3 3 0 0 1 1 2.200V14H6v-2.700a3 3 0 0 1 1-2.200l1-.9A3 3 0 0 0 9 6V3zM4 18h16v3H4v-3z',
  table: 'M4 5h16v14H4V5zm0 5h16M4 14.500h16M9.500 5v14',
  arrow: 'M5 12h14m0 0l-6-6m6 6l-6 6',
}

export function Icon({ n, class: cls = 'size-5' }: { n: keyof typeof PATHS | string; class?: string }) {
  return (
    <svg class={`shrink-0 ${cls}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={PATHS[n] ?? ''} />
    </svg>
  )
}

export function Logo() {
  return (
    <svg class="size-10 shrink-0" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="18" fill="#0f766e" />
      <path d="M20 14h16l10 10v24a4 4 0 0 1-4 4H20a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4z" fill="#fff" />
      <path d="m24 35 5 5 10-11" fill="none" stroke="#0f766e" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}
