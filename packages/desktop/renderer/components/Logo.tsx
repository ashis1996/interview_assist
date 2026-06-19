// Logo — the In_App_Brand_Mark for the desktop client (dev-release task 6.2, Req 5.4).
//
// This is a self-contained inline SVG, intentionally NOT loading the packaged
// build/icon.png|.ico asset: the renderer brand mark stays an inline SVG that
// inherits the existing icon-set conventions (a `size` prop, no external asset
// import), so it scales crisply at any size and ships in the JS bundle.
//
// The mark mirrors the generated placeholder app icon — an indigo rounded
// square with a centered white circle — so the in-app brand reads as the same
// product identity as the Windows taskbar/installer icon. It replaces the
// placeholder BrainLogo in the toolbar and the CollapsedPill.

import React from 'react'

export function Logo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {/* Indigo rounded square — the brand field. */}
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" fill="#4f46e5" />
      {/* Centered white circle — the brand mark. */}
      <circle cx="12" cy="12" r="5.25" fill="#ffffff" />
    </svg>
  )
}
