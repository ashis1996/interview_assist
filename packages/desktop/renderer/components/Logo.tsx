// Logo — the In_App_Brand_Mark for the desktop client (dev-release task 6.2, Req 5.4).
//
// Renders the product artwork (the Icons8 "natural food / peach" 3D-fluency
// image) shared with the Windows taskbar/installer icon, so the in-app brand
// mark — used in the toolbar and the collapse-to-pill control — reads as the
// same product identity everywhere. The image is bundled by Vite at build time
// (imported as a URL), so it ships in the renderer assets and needs no network.

import React from 'react'
import logoUrl from '../assets/logo.png'

export function Logo({ size = 26 }: { size?: number }): React.JSX.Element {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Interview Assistant"
      draggable={false}
      style={{ display: 'block', objectFit: 'contain', userSelect: 'none' }}
    />
  )
}
