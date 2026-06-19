# Go-To-Market & Monetization Strategy

> **Status:** PLANNING / DEFERRED. The current focus is MVP quality and testing.
> Nothing in this document is implemented yet. It captures the cost model,
> pricing strategy, competitor analysis, and the technical work required to
> turn the MVP into a paid product, so it can be executed in the GTM phase.
>
> **All monetary figures are INDICATIVE estimates** (provider rates, ad metrics,
> and user behavior vary). Validate against real quotes and early-user data
> before committing. Conversion used: **₹84 / USD**.

---

## 1. Cost structure (the key insight)

At realistic session lengths, **STT (speech-to-text) is ~85–90% of variable
cost.** The LLM (on Groq) is nearly free, and infra (a lightweight WebSocket
relay) is tiny. Therefore:

- **Optimize STT, not the LLM prompt**, for cost.
- The LLM prompt-size / history optimizations matter for **latency**, not cost.

### Per-session variable cost (1.5 hr session, indicative)

Assumptions: Deepgram Nova-2 streaming ≈ $0.0058/min; Groq `gpt-oss-120b`
≈ $0.15/1M input + $0.75/1M output; ~30 answers/session.

| Component | Without optimization | With optimization (VAD + slim prompt) |
|---|---|---|
| STT (Deepgram) | 90 min → ~₹44 | ~54 min → ~₹26 |
| LLM (Groq) | ~₹1.9 | ~₹1.5 |
| Infra (compute/DB/bandwidth) | ~₹2.5 | ~₹2.5 |
| **Total / session** | **~₹48** | **~₹30** |

**VAD gating (client-side voice-activity gating) is already implemented** — it
streams audio only around speech, dropping dead air. This is the main STT cost
lever and yields roughly the "with optimization" column.

### Output tokens dominate LLM cost
Output is ~5× the price of input. The biggest LLM lever is **answer length**
(crisp bullets + `maxOutputTokens` cap), not trimming the system prompt.

---

## 2. Scaling cost model

Variable cost scales **linearly**; unit economics do **not** degrade with scale.
What changes at scale is **volume discounts, provider concurrency limits, and
fixed costs** — not per-unit cost.

### 1,000 sessions/day (30,000/month) — monthly P&L (optimized, GST-inclusive ₹300)

| Line | ₹/month |
|---|---|
| Gross revenue (30,000 × ₹300) | 90,00,000 |
| − GST 18% (if price inclusive) | −13,72,800 |
| **Net revenue** | **76,27,200** |
| − STT | −7,80,000 |
| − LLM | −45,000 |
| − Infra | −75,000 |
| − Payment gateway (~2.36%) | −2,12,400 |
| **Contribution margin** | **~65,00,000** |
| − Fixed (lean team + infra baseline, example) | −8,00,000 |
| **≈ Net profit** | **~57,00,000 (~63% margin)** |

> If priced **₹300 + GST** (exclusive) instead of inclusive, net profit rises
> ~₹13.7L/month (you keep the full ₹300).

### Thousands concurrent / 20,000 sessions/day
- Margins hold (~85–90% on variable cost).
- **STT remains ~87% of variable cost** and becomes the #1 lever:
  - **Enterprise/committed Deepgram pricing** cuts $/min 30–50%.
  - **Self-hosted Whisper on GPUs** is ~4–5× cheaper per minute at sustained
    high concurrency (e.g., ~$190/hr GPU fleet vs ~$875/hr Deepgram at 2,500
    concurrent) — but adds heavy ops (GPU autoscaling, a Python ML service).
    Only worth it at sustained, predictable high volume.
- **Provider concurrency caps are the binding constraint** (not cost). Needs
  enterprise contracts + a multi-key router + multi-provider failover.
- Infra compute stays cheap; **audio ingress (~90 MB/session) is free** on major
  clouds. Postgres + Redis a few hundred $/month.

---

## 3. Recommended pricing strategy

**Adopt metered hour-packs, not "unlimited."** Metering the one expensive thing
(hours of live interview = STT minutes) makes COGS scale with revenue and
eliminates account-sharing abuse. This is what the strongest competitor does.

### Principles
1. **Metered hour-packs** as the core SKU (COGS-aligned, abuse-proof).
2. **Good-better-best 3 tiers** with a "Most popular" middle and a high anchor.
3. **GST-exclusive** pricing (charge base + 18% GST → keep the full base).
4. **Bundle low-COGS software** (resume builder, transcript history, question
   bank, post-interview feedback, "jobs") to inflate perceived value + stickiness
   and reframe from "cheat tool" → "job-search platform" (also safer for ad
   policy).
5. **Localization gate** (Hinglish / Indian interview context) as a premium feature.
6. **Optional monthly fair-use plan** for power users → adds MRR competitors lack
   (guarded by single-concurrent-session + device caps + fair-use throttle).

### "Unlimited" plan analysis (if offered)
- Net of GST+PG, a ₹2,200/mo plan ≈ ₹1,820 net → break-even at **~60 sessions
  /month** (no individual does this) → **safe per-user**.
- **The only real risk is account sharing.** Mitigate with: one concurrent
  session per account, device cap (e.g., 2), login/OTP, fair-use soft cap.
- Trade-off: heavy users (whom unlimited attracts) get capped → slight ARPU dip,
  offset by predictable MRR + higher conversion (price certainty).
- **Recommendation:** prefer metered packs; offer unlimited only as a guarded
  power-user tier.

---

## 4. Competitor analysis (reference)

A competitor sells **one-time metered hour-packs**, GST-exclusive, with a
software bundle and 3-tier anchoring:

| Tier | Net price | Hours | ₹/hr | Note |
|---|---|---|---|---|
| Standard | ₹1,199 (was ₹1,499) | 3 hr | ₹400 | entry |
| Pro | ₹1,999 (was ₹2,499) | 7 hr | ₹286 | "Most popular" (center decoy) |
| Pro Max | ₹2,999 (was ₹3,999) | 12 hr | ₹250 | high anchor |

**Decoded tactics:**
- Sells **hours** → COGS-aligned, no sharing abuse.
- **One-time** packs → fits the short job-seeker lifecycle, no churn mechanics
  (but no MRR).
- **Volume discount in ₹/hr** pushes up-tier; **"Most popular" middle** is the
  center-stage decoy; high top tier anchors.
- **Permanent strike-through "discounts"** for urgency/value anchoring.
- **GST charged on top** (keeps full base + builds trust via transparency).
- **Low-COGS bundle** (resume builder, CV uploads, jobs, transcript storage,
  watermark-free, priority support) inflates value + stickiness.
- **"Desi Mode"** localization as a premium paywall feature.
- Reverse-engineered margin: ₹250–400/hr vs ~₹25–35/hr COGS → **~86–93% gross**.

**Where they're beatable:** higher ₹/hr (₹250–400 vs our ~₹200/hr), "meter
anxiety," no MRR, and our latency/stealth edge (Groq + prewarm + streaming +
reconnect resilience).

---

## 5. Acquisition (CAC) & channels

### Subscriber math (to sustain 1,000 sessions/day = 30,000/month)
- Active paying users needed ≈ 30,000 ÷ (sessions per active user/month).
  - @5 sessions/user/mo → **~6,000 active**; @8 → ~3,750.
- **Fast churn** (users leave when hired in ~1–2 months) → must replenish
  ~3,500–5,000 new paying users/month.
- **Funnel:** if 15–20% of registered users are active-paying, total signup base
  needed ≈ **30,000–50,000**.

### Paid ads (Instagram / YouTube, India) — indicative
- Realistic **CAC ≈ ₹600–1,200** (conservative funnel can hit ₹3,000; tight funnel ~₹170).
- To reach ~6,000 active: **₹24–50 lakh up front**, **₹16–33 lakh/month** to hold
  it (churn replenishment).
- **LTV ÷ CAC** check (contribution LTV ~₹1,600): viable only if **CAC < ~₹500**.
  At typical CAC (~₹800+), paid-only is break-even-to-loss.

### ⚠️ Two hard constraints
1. **Ad-platform policy:** Meta/Google **prohibit ads promoting interview/exam
   cheating.** Ads will likely be rejected/banned unless positioned as
   **interview *preparation*/coaching**. This can make paid-social unworkable for
   the literal use case.
2. **Don't rely on ads alone.** Cheaper, durable channels: **referral**
   (invite-a-friend free time), **organic/word-of-mouth** (spreads peer-to-peer),
   **content/SEO**, **college ambassadors/communities**. Use paid to amplify.

---

## 6. Deferred technical work (to enable monetization)

These are NOT in the MVP. Implement in the GTM phase, in roughly this order:

1. **Hours/credit metering against a purchased pack.**
   - Repurpose the existing **append-only credit ledger** to bill *live-interview
     minutes* (STT minutes are already metered via `recordUsage`).
   - Deduct from a purchased "hours" balance; block/“out of time” when exhausted.
   - Surface remaining hours in the overlay.
2. **Single-concurrent-session guard** (per account) — reject/replace a second
   live session for the same account. Kills simultaneous account sharing.
   (Sessions are already keyed by account in the gateway → contained change.)
3. **Fair-use throttle** (for any "unlimited" tier) — soft cap + throttle.
4. **Device cap / login limits** (e.g., 2 devices, OTP) — anti-sharing.
5. **Payment integration** (Razorpay for India) — packs/plans, GST-exclusive
   invoicing, webhook → credit top-up into the ledger.
6. **Plan/entitlement management** — tier features (templates, Desi Mode,
   watermark-free, priority support) gated by plan.
7. **Value-bundle features** (low COGS, high perceived value): resume builder,
   transcript history/export (partly exists), question bank, post-interview
   feedback report, "jobs."
8. **Localization ("Desi Mode")** — Hinglish / Indian interview context.
9. **STT cost program** (at scale): enterprise Deepgram contract and/or
   self-hosted Whisper GPU service evaluation; multi-provider failover + key pool.

---

## 7. Open questions to validate with data

- Real **sessions-per-candidate** and **session length** distribution (drives
  subscriber count and pack sizing).
- Real **CAC** from a small (₹50k–1L) paid test, and **ad-policy approval**.
- **Per-hour price** sweet spot vs the competitor (undercut vs match-with-value).
- **One-time packs vs monthly** mix (conversion vs MRR).
- Actual **silence ratio** in interviews (drives VAD/STT savings).
- GST registration & **inclusive vs exclusive** pricing decision.

---

## 8. Summary recommendation

- **Now:** finish MVP + testing; keep VAD gating on; keep Groq for the LLM.
- **GTM:** launch **metered hour-packs**, 3 tiers, **GST-exclusive**, with a
  low-COGS value bundle and localization; add a **guarded fair-use monthly** tier
  for MRR. Ship the **hours-metering + single-concurrent-session guard** first.
- **Cost:** optimize **STT** (enterprise pricing → self-host at scale); ignore LLM
  cost. Margins are ~85–90% on variable; **CAC and GST are the real P&L drivers.**
