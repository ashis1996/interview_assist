# syntax=docker/dockerfile:1

# ----------------------------------------------------------------------------
# Backend container image for the Interview Assistant SaaS (Dev Release).
#
# IMPORTANT: build from the REPO ROOT, not from packages/backend, so the build
# can see the root workspace manifests (package.json + package-lock.json) and
# the @interview-assistant/shared workspace package. Example:
#
#   docker build -f packages/backend/Dockerfile -t interview-assistant-backend .
#
# (Railway builds from the repo root automatically when pointed at this
# Dockerfile path.)
#
# The backend runs straight from TypeScript via tsx (no compile step) and
# consumes @interview-assistant/shared as TS source, so the image keeps the
# installed node_modules plus the shared + backend sources and starts with the
# workspace `start` script (`tsx index.ts`).
#
# No secrets are baked into the image — every Provider_Secret and connection
# string is supplied at runtime through host environment variables.
# ----------------------------------------------------------------------------

# --- deps stage: install workspace dependencies from the lockfile ------------
FROM node:20-slim AS deps
WORKDIR /app

# Copy only the manifests first so the dependency install layer is cached
# independently of source changes. The backend workspace depends on the shared
# workspace, so both manifests are required for npm to resolve the workspace
# symlink during install.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/backend/package.json packages/backend/package.json

# Reproducible install scoped to the backend workspace (plus the workspace
# root), which also links the @interview-assistant/shared workspace dependency.
# tsx ships as a backend dependency, so it is present in the resulting
# node_modules and is used to run the app.
RUN npm ci --workspace @interview-assistant/backend --include-workspace-root

# --- runtime stage -----------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Bring in the installed dependencies (incl. the @interview-assistant/shared
# workspace symlink) and the root manifest from the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json

# Copy the workspace sources. @interview-assistant/shared is consumed as TS
# source (via tsx), so it must be present alongside the backend for the
# node_modules symlink to resolve at runtime.
COPY packages/shared ./packages/shared
COPY packages/backend ./packages/backend

# Railway injects PORT at runtime; the backend binds 0.0.0.0:$PORT (default
# 8787 when PORT is unset). EXPOSE is documentation only — the platform maps
# the injected port and terminates TLS/WSS at its edge.
EXPOSE 8787

# Start the backend via the workspace `start` script (`tsx index.ts`). The
# startup path applies the idempotent schema migration before it begins
# listening.
CMD ["npm", "run", "start", "--workspace", "@interview-assistant/backend"]
