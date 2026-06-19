/// <reference types="vite/client" />

// Build-time env vars electron-vite inlines into the MAIN bundle as
// `import.meta.env.MAIN_VITE_*` (dev-release, design §C). Declared here so the
// main-process code can read them with DIRECT static access (which is what
// lets Vite replace them with string literals at build time). All optional —
// in non-built runtimes (vitest) they resolve to `undefined`.
interface ImportMetaEnv {
  readonly MAIN_VITE_APP_ENV?: string
  readonly MAIN_VITE_DEV_BACKEND_URL?: string
  readonly MAIN_VITE_DEV_GATEWAY_URL?: string
  readonly MAIN_VITE_DEV_SUPABASE_URL?: string
  readonly MAIN_VITE_DEV_SUPABASE_ANON_KEY?: string
}
