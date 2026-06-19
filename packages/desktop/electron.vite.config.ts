import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Externalize real npm dependencies (ws, @supabase/supabase-js, ...) so they are
// loaded from node_modules at runtime instead of bundled — this avoids bundling
// ws's optional native add-ons (bufferutil/utf-8-validate). The shared workspace
// package is TypeScript source, so it must be BUNDLED, not externalized.
const externalize = externalizeDepsPlugin({ exclude: ['@interview-assistant/shared'] })

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
    plugins: [externalize],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'main/index.ts') }
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
