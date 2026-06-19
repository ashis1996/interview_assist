// Pure credit/ledger arithmetic for the Credits_Service.
//
// Keeping the conversion and balance math pure makes the ledger and
// conversion invariants property-testable (design Properties 1, 3) without a
// database. The Postgres-backed repository wraps these functions.

/** Credits charged per metered unit. Both rates are non-negative. */
export interface ConversionRate {
  creditsPerSttMinute: number
  creditsPerLlmToken: number
}

/** Metered usage for a Session. Both components are non-negative. */
export interface Usage {
  sttMinutes: number
  llmTokens: number
}

/**
 * Ledger entry types (Req 11.4):
 * - `usage-debit`: enforced debit; reduces the Credit_Balance.
 * - `non-enforced-debit`: dev/local marker; recorded but excluded from the
 *   enforced balance (Req 11.5).
 * - `purchase-credit`: future credit addition; reserved for v-next (Req 11.4).
 */
export type LedgerEntryType = 'usage-debit' | 'non-enforced-debit' | 'purchase-credit'

/** An append-only credit ledger entry. Amounts are signed (debits negative). */
export interface LedgerEntry {
  id: string
  accountId: string
  type: LedgerEntryType
  amount: number
  sessionId?: string
  createdAt: string
}

/**
 * Convert metered usage to credits using the conversion rate (Req 9.3).
 * Monotonic non-decreasing in each usage component and always >= 0 for
 * non-negative inputs (design Property 3).
 *
 * @param rate Non-negative per-unit credit rates.
 * @param u Non-negative metered usage.
 * @returns The number of credits the usage converts to.
 */
export function usageToCredits(rate: ConversionRate, u: Usage): number {
  return rate.creditsPerSttMinute * u.sttMinutes + rate.creditsPerLlmToken * u.llmTokens
}

/**
 * Entry types that affect the enforced Credit_Balance. `non-enforced-debit`
 * entries are recorded for dev visibility but excluded (Req 11.2, 11.5).
 */
function affectsBalance(type: LedgerEntryType): boolean {
  return type !== 'non-enforced-debit'
}

/**
 * Compute the Credit_Balance as the sum of all balance-affecting ledger entries
 * for an account (Req 11.2 / design Property 1).
 *
 * @param entries The account's append-only ledger entries.
 * @returns The current balance (sum of `usage-debit` and `purchase-credit` amounts).
 */
export function ledgerBalance(entries: readonly LedgerEntry[]): number {
  return entries.reduce((sum, e) => (affectsBalance(e.type) ? sum + e.amount : sum), 0)
}
