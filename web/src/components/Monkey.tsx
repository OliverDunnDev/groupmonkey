// Flat, sharp mascot artwork in the app palette (black, yellow, white). Pure SVG, no assets to load.

const BLACK = '#0A0A0A'
const YELLOW = '#FFD400'

/** The GroupMonkey face: black head and ears, yellow face mask. Decorative unless `title` is given. */
export function MonkeyFace({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* ears */}
      <circle cx="8" cy="33" r="9" fill={BLACK} />
      <circle cx="8" cy="33" r="4" fill={YELLOW} />
      <circle cx="56" cy="33" r="9" fill={BLACK} />
      <circle cx="56" cy="33" r="4" fill={YELLOW} />
      {/* head */}
      <circle cx="32" cy="31" r="23" fill={BLACK} />
      {/* face mask */}
      <path
        d="M32 26 C28 17 13 20 13 32 C13 37 17 41 22 42 C25 50 39 50 42 42 C47 41 51 37 51 32 C51 20 36 17 32 26 Z"
        fill={YELLOW}
      />
      {/* eyes */}
      <circle cx="25" cy="32" r="3.2" fill={BLACK} />
      <circle cx="39" cy="32" r="3.2" fill={BLACK} />
      <circle cx="26" cy="31" r="1" fill="#fff" />
      <circle cx="40" cy="31" r="1" fill="#fff" />
      {/* nose and grin */}
      <circle cx="30" cy="41" r="1.3" fill={BLACK} />
      <circle cx="34" cy="41" r="1.3" fill={BLACK} />
      <path d="M25 45 Q32 51 39 45" fill="none" stroke={BLACK} strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

/** A banana, used as the "done" reward. `onDark` swaps the black outline for white so it stays visible on black headers and badges. */
export function Banana({ className, title, onDark }: { className?: string; title?: string; onDark?: boolean }) {
  const ink = onDark ? '#FFFFFF' : BLACK
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {/* body: a fat smile-shaped crescent */}
      <path
        d="M3 14 C5 27 22 30 28 8 C24 6 22 8 21 12 C18 21 10 22 7 12 Z"
        fill={YELLOW}
        stroke={ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* ridge line, stem and tip */}
      <path d="M8 15 C12 21 19 20 22 11" fill="none" stroke={ink} strokeWidth="1.2" strokeLinecap="round" />
      <rect x="23" y="2" width="6" height="6" transform="rotate(25 26 5)" fill={ink} />
      <circle cx="3.6" cy="13.4" r="2" fill={ink} />
    </svg>
  )
}
