// CollapsedPill — the floating brand-mark pill the window collapses to (Req 8).
//
// Extracted from Overlay.tsx so the minimize-to-pill control can be rendered
// app-wide on every screen (sign-in, onboarding, ready, interview), not just
// the interview overlay. It is a pure presentational component: it owns no
// state and delegates expand to the caller via `onExpand`, which is wired to
// both a double-click on the pill and a click on the explicit expand button.
//
// The brand mark uses the In_App_Brand_Mark Logo component (task 6.2), kept in
// its own import slot so the brand identity stays consistent app-wide.

import React from 'react'
import { ExpandIcon } from '../icons'
import { Logo } from './Logo'

export function CollapsedPill({ onExpand }: { onExpand: () => void }): React.JSX.Element {
  return (
    <div className="pk-pill" title="Interview Assistant" onDoubleClick={onExpand}>
      <Logo size={28} />
      <button className="pk-pill-expand" onClick={onExpand} title="Expand">
        <ExpandIcon size={12} />
      </button>
    </div>
  )
}
