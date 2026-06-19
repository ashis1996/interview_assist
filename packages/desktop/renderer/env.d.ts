/// <reference types="vite/client" />

import type { PreloadApi } from '../main/preload'

declare global {
  interface Window {
    api: PreloadApi
  }
}

export {}
