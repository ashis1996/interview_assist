import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// IMPORTANT (monorepo packaging): the MAIN process deps (ws, @supabase/supabase-js,
// pdf-parse, mammoth) are BUNDLED into out/main rather than externalized. In this
// npm-workspaces repo those deps are hoisted to the ROOT node_modules, so
// electron-builder (which collects production deps from packages/desktop/node_modules)
// would ship an app with NO node_modules and the main process would crash at runtime
// with MODULE_NOT_FOUND. Bundling makes the build self-contained and independent of
// node_modules layout. electron-vite still keeps `electron` and Node built-ins
// external automatically; we additionally externalize ws's OPTIONAL native add-ons
// (bufferutil/utf-8-validate) — ws falls back to pure JS when they are absent.
//
// The preload still externalizes deps (it only uses electron + bundled shared types).
const externalize = externalizeDepsPlugin({ exclude: ['@interview-assistant/shared'] })

// Optional native add-ons that `ws` tries to require but does not need; keep them
// out of the bundle so Rollup doesn't fail resolving them.
const WS_OPTIONAL_NATIVE = ['bufferutil', 'utf-8-validate']

// ---------------------------------------------------------------------------
// Build-time config injection (dev-release, design §C / Data Models).
//
// electron-vite loads env vars from `.env` files (and the build environment)
// and, by its built-in per-process prefixing, inlines those prefixed with
// `MAIN_VITE_` into the MAIN bundle as `import.meta.env.MAIN_VITE_*`
// (`PRELOAD_VITE_` → preload, `RENDERER_VITE_` → renderer). This default
// behavior is exactly what the packaged dev client relies on to carry its
// `dev` endpoints + Supabase publishable key — so this config deliberately
// does NOT set a custom `envPrefix` or a `define` that would strip/override it.
//
// Required build vars for a `dev` installer (public — anon key + URLs, NOT
// secrets per Req 2.5; see packages/desktop/.env.example):
//   MAIN_VITE_APP_ENV=dev
//   MAIN_VITE_DEV_BACKEND_URL=https://<app>.up.railway.app
//   MAIN_VITE_DEV_GATEWAY_URL=wss://<app>.up.railway.app
//   MAIN_VITE_DEV_SUPABASE_URL=https://<ref>.supabase.co
//   MAIN_VITE_DEV_SUPABASE_ANON_KEY=<publishable-anon-key>
//
// Set these in the build environment (a local `.env`/`.env.dev` or CI vars)
// before `electron-vite build`; they are baked into `out/main` at build time.
// ---------------------------------------------------------------------------

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'main/index.ts') },
        external: WS_OPTIONAL_NATIVE
      }
    }
  },
  preload: {
    plugins: [externalize],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'main/preload.ts') }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'renderer/index.html') }
      }
    },
    plugins: [react()]
  }
})
