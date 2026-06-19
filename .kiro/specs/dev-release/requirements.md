# Requirements Document

## Introduction

The Dev Release is the work required to ship a Dev/MVP build of the existing Interview Assistant SaaS (defined in `.kiro/specs/interview-assistant-saas/`) so that a small group of testers can install and exercise the product against a hosted backend. The product comprises an Electron desktop client (Windows), a Node/Fastify backend, a shared TypeScript domain, a Supabase identity service, and a Postgres database. The pipeline, domain logic, session protocol, credit ledger, and overlay already exist; this spec does NOT re-specify them. It captures only the delta needed to deploy, package, brand, secure, and distribute a testable dev build.

The Dev Release introduces four areas of new behavior plus the code changes that enable them. First, the Backend is deployed to a cost-effective host with a managed Postgres database, reachable by the Desktop_Client over secure transports at a stable URL, running as the dev environment with all provider secrets supplied server-side. Second, the Desktop_Client is packaged as an installable Windows executable that points at the deployed Dev_Backend and resolves its runtime environment to dev. Third, the product carries real branding (logo, Windows icon set, in-app brand mark, installer imagery) in place of the current placeholder. Fourth, the dev environment enforces sign-in (email/password and Google OAuth) while granting a short allow-list of approximately five Superuser_Accounts (including the owner) unlimited usage that bypasses credit enforcement, with everyone else subject to normal enforcement.

Two existing behaviors must be reconciled for this release. The Desktop_Client currently resolves packaged builds to the prod environment (`app.isPackaged ? 'prod' : 'local'`); the dev release must resolve packaged dev builds to the dev environment instead. The dev environment currently bypasses both authentication and credit enforcement; the dev release must enforce authentication in dev and apply normal credit enforcement to non-superuser accounts. The minimize-to-floating-pill control currently exists only on the interview overlay; the dev release must make it available on every screen.

The following are explicit non-goals for the Dev Release, deferred to the Go-To-Market phase documented in `docs/go-to-market.md`: payment and checkout integration, hour/credit pack purchase and metering as a paid SKU, pricing tiers, fair-use throttling, single-concurrent-session guards, device caps, and application auto-update.

## Glossary

- **System**: The Interview Assistant SaaS product as deployed and distributed for the Dev Release, comprising the Desktop_Client and the Dev_Backend.
- **Desktop_Client**: The Electron desktop application that runs on the tester's Windows PC.
- **Dev_Backend**: The deployed instance of the Node/Fastify backend running as the dev Environment, holding all provider secrets and serving the Desktop_Client.
- **Hosting_Provider**: The third-party platform on which the Dev_Backend is deployed (a cost-effective or free-tier host).
- **Managed_Database**: The hosted Postgres database (a managed free-tier offering) used by the Dev_Backend in the dev Environment.
- **Stable_Backend_URL**: The fixed, externally reachable address of the Dev_Backend that does not change between Desktop_Client launches for the duration of the Dev Release.
- **WSS_Endpoint**: The secure WebSocket (`wss://`) address of the Session_Gateway on the Dev_Backend used for interview Sessions.
- **HTTPS_Endpoint**: The secure HTTP (`https://`) base address of the Dev_Backend used for REST requests such as the credit balance and profile.
- **Environment**: One of the deployment targets the Desktop_Client can resolve to: local, dev, pre-prod, or prod, as defined in the interview-assistant-saas spec.
- **Resolved_Environment**: The Environment value the Desktop_Client determines at runtime from the build and runtime configuration, not chosen by the User.
- **Windows_Installer**: The installable Windows executable artifact produced by the desktop packaging process that a tester runs to install the Desktop_Client.
- **Packaged_Build**: A Desktop_Client build produced by the packaging process (as opposed to a development run).
- **Backend_Endpoint_Configuration**: The set of values (HTTPS_Endpoint, WSS_Endpoint, and Supabase project settings) that direct the Desktop_Client to the Dev_Backend, supplied at build time or runtime rather than hard-coded.
- **Provider_Secret**: A credential for a third-party provider used by the Backend, specifically the Deepgram API key, the Groq/Gemini LLM API key, and the Supabase service-role key.
- **Brand_Assets**: The collection of visual identity files for the product: the logo, the Windows icon set, the in-app brand mark, and the installer imagery.
- **Windows_Icon_Set**: The Windows icon file (`.ico`) used for the application window, the taskbar, and the Windows_Installer.
- **In_App_Brand_Mark**: The brand mark displayed inside the Desktop_Client user interface.
- **Identity_Provider**: The Supabase Auth service that authenticates Users and issues tokens, as defined in the interview-assistant-saas spec.
- **Email_Password_Sign_In**: The sign-in method using an email address and password.
- **Google_OAuth_Sign_In**: The sign-in method using Google through an authorization-code-with-PKCE flow in the system browser.
- **Auth_Enforcement_Mode**: The per-Environment setting determining whether authentication is enforced.
- **Credit_Enforcement_Mode**: The per-Environment setting determining whether credit limits are enforced.
- **Credits_Service**: The Backend component that maintains the Credit_Balance, records ledger entries, meters usage, and enforces credit limits.
- **Credit_Balance**: The current number of credits available on an Account.
- **Session_Gateway**: The Backend component that terminates the interview Session WebSocket and runs the pre-session credit check.
- **Account**: The persisted record of a User, keyed by the verified identity reference from the Identity_Provider.
- **Superuser_Account**: An Account designated for unlimited usage during the Dev Release, for which credit enforcement is bypassed regardless of Credit_Balance.
- **Superuser_Flag**: A persisted boolean (`is_superuser`) on an Account that designates it as a Superuser_Account; managed by the owner through the database/dashboard, not by the Desktop_Client.
- **Account_Directory**: The owner-facing view of registered Accounts and their associated email, profile, usage, and Superuser_Flag — provided by the database/dashboard (Supabase Table Editor) for the Dev Release.
- **Regular_Account**: Any authenticated Account in the dev Environment that is not a Superuser_Account.
- **Screen**: A distinct top-level view of the Desktop_Client: the sign-in screen, the onboarding screen, the ready/home screen, and the interview overlay.
- **Minimize_Pill**: The collapsed floating brand-mark control that shrinks the Desktop_Client window to a small draggable pill and can restore it.
- **Content_Protection**: The Windows screen-capture exclusion applied to the Desktop_Client window so it does not appear in screen shares or recordings.

## Requirements

### Requirement 1: Backend Deployment to a Hosted Dev Environment

**User Story:** As the product owner, I want the Backend deployed to a cost-effective host running as the dev environment, so that testers can use the product without running the Backend locally.

#### Acceptance Criteria

1. THE Dev_Backend SHALL run on a Hosting_Provider that offers a free tier or a cost-effective tier suitable for MVP testing.
2. THE Dev_Backend SHALL run with its Environment resolved to dev.
3. THE Dev_Backend SHALL persist all Account, Session, profile, usage, and credit-ledger data in a Managed_Database that offers a free tier.
4. WHEN the Dev_Backend is deployed, THE deployment process SHALL apply the schema defined in `packages/backend/db/schema.sql`, including the `company` and `background` profile columns, to the Managed_Database before the Dev_Backend serves requests.
5. THE Dev_Backend SHALL expose a Stable_Backend_URL that remains unchanged across Desktop_Client launches for the duration of the Dev Release.
6. THE Dev_Backend SHALL accept interview Session connections over a WSS_Endpoint.
7. THE Dev_Backend SHALL accept REST requests over an HTTPS_Endpoint.
8. WHEN the Desktop_Client connects to the Dev_Backend over the WSS_Endpoint or the HTTPS_Endpoint, THE Dev_Backend SHALL serve the request using transport-layer encryption.

### Requirement 2: Server-Side Provider Secrets in the Dev Environment

**User Story:** As the product owner, I want all provider secrets supplied to the Backend through the host environment, so that no secret is ever distributed in the desktop client.

#### Acceptance Criteria

1. THE Dev_Backend SHALL read each Provider_Secret from a Hosting_Provider environment variable at runtime.
2. THE Dev_Backend SHALL obtain the Deepgram API key, the Groq or Gemini LLM API key, and the Supabase service-role key from Hosting_Provider environment variables.
3. THE Desktop_Client distribution SHALL exclude every Provider_Secret from the Windows_Installer and from all files the Windows_Installer places on the tester's machine.
4. WHEN the Desktop_Client requires speech-to-text or large-language-model processing, THE Desktop_Client SHALL obtain that processing through the Dev_Backend rather than by holding any Provider_Secret.
5. WHERE the Desktop_Client connects to the dev Environment, THE Desktop_Client SHALL hold only the Backend_Endpoint_Configuration and the Supabase publishable key, and SHALL hold no Provider_Secret.

### Requirement 3: Windows Desktop Packaging

**User Story:** As a tester, I want an installable Windows executable, so that I can install and run the app on my Windows machine.

#### Acceptance Criteria

1. THE desktop packaging process SHALL produce a Windows_Installer as an installable Windows executable.
2. WHEN a tester runs the Windows_Installer on a supported Windows machine, THE Windows_Installer SHALL install the Desktop_Client so that it can be launched.
3. THE Packaged_Build SHALL exclude development-only sources and Provider_Secrets from the distributed artifact.
4. WHEN a tester launches an installed Packaged_Build, THE Desktop_Client SHALL start without requiring the tester to provide any Backend_Endpoint_Configuration or Provider_Secret.

### Requirement 4: Packaged Build Targets the Dev Backend

**User Story:** As a tester, I want the installed app to connect to the deployed dev backend automatically, so that I do not have to configure any URLs.

#### Acceptance Criteria

1. THE Desktop_Client SHALL resolve the Backend_Endpoint_Configuration for the Dev_Backend from a build-time or runtime configuration value rather than from a hard-coded address.
2. WHEN a Packaged_Build for the Dev Release launches, THE Desktop_Client SHALL set its Resolved_Environment to dev.
3. WHEN the Resolved_Environment is dev, THE Desktop_Client SHALL direct all Session_Gateway requests to the Dev_Backend WSS_Endpoint and all Credits_Service and profile requests to the Dev_Backend HTTPS_Endpoint.
4. WHERE a Packaged_Build for the Dev Release is launched, THE Desktop_Client SHALL NOT resolve its Environment to prod.
5. WHILE the Resolved_Environment is dev, THE Desktop_Client SHALL display an indication that the active Environment is dev.

### Requirement 5: Product Branding and Icons

**User Story:** As the product owner, I want the app and installer to carry the product name and branding, so that testers see a finished, identifiable product.

#### Acceptance Criteria

1. THE Brand_Assets SHALL include a logo, a Windows_Icon_Set, an In_App_Brand_Mark, and the installer imagery required by the Windows_Installer.
2. THE Windows_Icon_Set SHALL provide a `.ico` file applied to the application window, the taskbar entry, and the Windows_Installer.
3. THE Packaged_Build SHALL carry the product name in the application metadata and in the Windows_Installer.
4. WHILE the Desktop_Client is running, THE Desktop_Client SHALL display the In_App_Brand_Mark in place of the placeholder brain mark currently shown in the overlay.
5. WHEN the Desktop_Client window is shown on Windows, THE Desktop_Client SHALL display the Windows_Icon_Set as the window and taskbar icon.

### Requirement 6: Enforced Authentication in the Dev Environment

**User Story:** As the product owner, I want sign-in required in the dev environment, so that each tester uses an identified account.

#### Acceptance Criteria

1. WHERE the Resolved_Environment is dev, THE Desktop_Client SHALL set the Auth_Enforcement_Mode to enforced.
2. WHEN the Desktop_Client launches in the dev Environment AND no valid session can be restored, THE Desktop_Client SHALL display the sign-in screen before allowing an interview to start.
3. WHEN a User signs in to the dev Environment, THE Desktop_Client SHALL authenticate the User through the Identity_Provider using Email_Password_Sign_In or Google_OAuth_Sign_In.
4. WHERE the Resolved_Environment is dev, WHEN the Desktop_Client opens an interview Session or sends a REST request, THE Desktop_Client SHALL include the Identity_Provider Access_Token.
5. WHERE the Resolved_Environment is dev, WHEN the Dev_Backend receives a request, THE Dev_Backend SHALL verify the Access_Token through Token_Verification, and IF the Access_Token is absent, expired, or invalid, THEN THE Dev_Backend SHALL reject the request with an authorization error.
6. WHERE the Resolved_Environment is dev, THE Dev_Backend SHALL NOT attribute requests to the synthetic Dev_Account used by auth-bypassed environments.

### Requirement 7: Superuser Designation, Unlimited Usage, and User Monitoring

**User Story:** As the product owner, I want to see who has registered and grant unlimited access to selected accounts (including mine) from a dashboard, so that my testers and I can test freely without consuming credits and I can monitor usage.

#### Acceptance Criteria

1. THE System SHALL persist a Superuser_Flag (`is_superuser`) on each Account, defaulting to false.
2. WHEN a User signs in for the first time in the dev Environment, THE Dev_Backend SHALL provision the Account with the verified email recorded for monitoring.
3. WHEN the Dev_Backend resolves the Account for an authenticated request, THE Dev_Backend SHALL determine whether the Account is a Superuser_Account from its Superuser_Flag.
4. WHERE the Account is a Superuser_Account, THE Credits_Service SHALL authorize each interview Session to start regardless of the Credit_Balance, AND THE Session_Gateway SHALL NOT perform a credit-exhaustion hard stop for that Account's Sessions, AND THE Credits_Service SHALL still record metered usage as a usage record.
5. WHERE the Account is a Regular_Account in the dev Environment, THE Credits_Service SHALL apply normal credit enforcement, including the pre-session credit check and the credit-exhaustion hard stop.
6. THE System SHALL provide the owner an Account_Directory (via the database/dashboard) to view registered Accounts with their email, profile, usage, and Superuser_Flag, and to set or clear the Superuser_Flag on any Account.
7. WHEN the owner sets or clears an Account's Superuser_Flag, THE change SHALL take effect on that Account's next Session without rebuilding or redistributing the Desktop_Client and without redeploying the Dev_Backend.
8. WHERE an email is listed in the optional Superuser_Bootstrap configuration, WHEN the matching Account is first provisioned, THE Dev_Backend SHALL set that Account's Superuser_Flag to true.

### Requirement 8: Minimize-to-Pill on Every Screen

**User Story:** As a tester, I want to collapse the window to the floating pill from any screen, so that I can hide the app at any moment.

#### Acceptance Criteria

1. THE Desktop_Client SHALL present a Minimize_Pill control on the sign-in screen, the onboarding screen, the ready/home screen, and the interview overlay.
2. WHEN the User activates the Minimize_Pill control on any Screen, THE Desktop_Client SHALL collapse the window to the floating pill.
3. WHEN the window is collapsed to the Minimize_Pill, THE Desktop_Client SHALL restore the window to the Screen that was active before collapsing when the User activates the expand control.
4. WHILE the window is collapsed to the Minimize_Pill on any Screen, THE Desktop_Client SHALL preserve Content_Protection so the pill does not appear in screen captures or shares.
5. WHILE any Screen is displayed and Content_Protection is supported, THE Desktop_Client SHALL exclude that Screen from screen captures or shares.
6. WHEN the window is collapsed to or restored from the Minimize_Pill, THE Desktop_Client SHALL keep the current authentication and interview state unchanged.

### Requirement 9: Release Hardening and Safe Logging

**User Story:** As the product owner, I want the dev release to avoid leaking secrets and to log safely, so that distributing the build does not expose credentials.

#### Acceptance Criteria

1. THE Desktop_Client SHALL exclude every Provider_Secret and every Supabase service-role key from its logs and from any file it writes on the tester's machine.
2. WHEN the Desktop_Client or the Dev_Backend logs an authentication event, THE log entry SHALL exclude the Access_Token value, the Refresh_Token value, and any Provider_Secret value.
3. IF the Backend_Endpoint_Configuration for the dev Environment is missing or unreadable when a Packaged_Build launches, THEN THE Desktop_Client SHALL display an indication that it cannot reach the configured backend rather than connecting to an unintended Environment.
4. THE Dev_Backend SHALL exclude every Provider_Secret value from any response returned to the Desktop_Client.

## Non-Goals

The following are explicitly out of scope for the Dev Release and are deferred to the Go-To-Market phase described in `docs/go-to-market.md`:

- Payment and checkout integration (for example, Razorpay).
- Hour or credit pack purchase as a paid SKU and the associated purchase-based credit additions.
- Pricing tiers and plan/entitlement management.
- Fair-use throttling and soft caps.
- Single-concurrent-session guards, device caps, and login limits.
- Application auto-update for the desktop client.
