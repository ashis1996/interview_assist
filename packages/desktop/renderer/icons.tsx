// Inline SVG icon set for the overlay. Self-contained (no icon-font / external
// dependency) so the bundle stays small and the icons inherit currentColor for
// easy theming. Stroke-based, 1.6px, rounded — a clean, modern control set that
// replaces the earlier emoji/text glyphs.

import React from 'react'

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number }

function Svg({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Brand mark: a stylised brain / neural node — the app logo. */
export function BrainLogo({ size = 26, ...rest }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...rest}>
      <path
        d="M9 3.5A2.5 2.5 0 0 0 6.5 6 2.5 2.5 0 0 0 5 8.3 2.6 2.6 0 0 0 4.3 13 2.6 2.6 0 0 0 5 17.6 2.5 2.5 0 0 0 7.5 20 2.4 2.4 0 0 0 10 18.2V5.8 A2.4 2.4 0 0 0 9 3.5Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M15 3.5A2.5 2.5 0 0 1 17.5 6 2.5 2.5 0 0 1 19 8.3 2.6 2.6 0 0 1 19.7 13 2.6 2.6 0 0 1 19 17.6 2.5 2.5 0 0 1 16.5 20 2.4 2.4 0 0 1 14 18.2V5.8 A2.4 2.4 0 0 1 15 3.5Z"
        fill="currentColor"
        opacity="0.8"
      />
      <path
        d="M12 6v12M9.5 9.5h2M12.5 12.5h2M9.5 14.5h2"
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

export const MicIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
  </Svg>
)

export const SpeakerIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 9.5v5h3l4.5 4v-13L7 9.5H4Z" />
    <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" />
  </Svg>
)

export const SparkIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" fill="currentColor" stroke="none" />
  </Svg>
)

export const CameraIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13" r="3.2" />
  </Svg>
)

export const ChatIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
    <path d="M8 10h8M8 13h5" />
  </Svg>
)

export const SettingsIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 13a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-2.9-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 4.6 13H4a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.1-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 11 4.6V4a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 19.4 11H20a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4.9Z" />
  </Svg>
)

export const CollapseIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M8 13h8M9.5 9.5L12 7l2.5 2.5" />
  </Svg>
)

export const ExpandIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 9l-4 0 0-4M15 9l4 0 0-4M9 15l-4 0 0 4M15 15l4 0 0 4" />
  </Svg>
)

export const CloseIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const CopyIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h9" />
  </Svg>
)

export const RegenIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M20 11a8 8 0 1 0-1.5 5" />
    <path d="M20 5v6h-6" />
  </Svg>
)

export const SendIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 12l16-7-7 16-2.5-6.5L4 12Z" />
  </Svg>
)
