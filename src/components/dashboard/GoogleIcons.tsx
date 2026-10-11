/** Inline Google-style glyphs (Drive / Chat / Meet) in brand colours; `muted` greys them out. Decorative only. */
type P = { size?: number; muted?: boolean };

const GREY = "#9CA3AF";

export function DriveIcon({ size = 14, muted = false }: P) {
  const [y, g, b] = muted ? [GREY, GREY, GREY] : ["#FBBC05", "#34A853", "#4285F4"];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M8.3 2.5h7.4L22.5 14.5h-7.4z" fill={y} />
      <path d="M8.3 2.5 1.5 14.5l3.7 6.5L12 9z" fill={g} />
      <path d="M5.2 21 8.9 14.5h13.6L18.8 21z" fill={b} />
    </svg>
  );
}

export function ChatIcon({ size = 14, muted = false }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4.5V5a2 2 0 0 1 2-2z" fill={muted ? GREY : "#34A853"} />
      <path d="M7 8h10M7 12h7" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function MeetIcon({ size = 14, muted = false }: P) {
  const [g1, g2, y, b, r] = muted ? [GREY, GREY, GREY, GREY, GREY] : ["#00832D", "#00AC47", "#FBBC05", "#4285F4", "#EA4335"];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="2" y="5" width="14" height="14" rx="2" fill={g1} />
      <rect x="2" y="5" width="6.5" height="7" fill={y} />
      <rect x="2" y="12" width="6.5" height="7" fill={b} />
      <rect x="8.5" y="5" width="7.5" height="4" fill={r} />
      <path d="M16 10.2 22 6.5v11L16 13.8z" fill={g2} />
    </svg>
  );
}
