// CollapsedPill — the floating peach the window collapses to (Req 8).
//
// The floating button IS the product artwork (the peach Logo) on a transparent
// background — no pill/circle chrome. It supports BOTH dragging the widget
// around the desktop AND a click to expand the window back open.
//
// Because the window is frameless/transparent there is no native title bar to
// grab, and a CSS `-webkit-app-region: drag` region swallows click events (so
// clicking to expand never fired). Instead we implement dragging manually:
// pointer deltas are streamed to the main process (`moveOverlayBy`) to reposition
// the window, and a pointer press that does NOT move past a small threshold is
// treated as a click → expand.

import React, { useCallback, useRef } from 'react'
import { Logo } from './Logo'

const DRAG_THRESHOLD_PX = 4

export function CollapsedPill({ onExpand }: { onExpand: () => void }): React.JSX.Element {
  const dragging = useRef(false)
  const last = useRef({ x: 0, y: 0 })
  const movedDistance = useRef(0)

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragging.current = true
    movedDistance.current = 0
    last.current = { x: e.screenX, y: e.screenY }
    ;(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const dx = e.screenX - last.current.x
    const dy = e.screenY - last.current.y
    if (dx === 0 && dy === 0) return
    movedDistance.current += Math.abs(dx) + Math.abs(dy)
    last.current = { x: e.screenX, y: e.screenY }
    window.api.moveOverlayBy(dx, dy)
  }, [])

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      dragging.current = false
      try {
        ;(e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId)
      } catch {
        /* capture may already be gone */
      }
      // A press that didn't travel far is a click → expand the panel.
      if (movedDistance.current < DRAG_THRESHOLD_PX) onExpand()
    },
    [onExpand]
  )

  return (
    <div
      className="pk-pill"
      title="Interview Assistant — click to open, drag to move"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <Logo size={56} />
    </div>
  )
}
