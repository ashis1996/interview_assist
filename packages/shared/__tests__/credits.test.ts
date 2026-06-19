import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  usageToCredits,
  ledgerBalance,
  type ConversionRate,
  type LedgerEntry,
  type LedgerEntryType,
} from '../credits'

const rateArb: fc.Arbitrary<ConversionRate> = fc.record({
  creditsPerSttMinute: fc.double({ min: 0, max: 1000, noNaN: true }),
  creditsPerLlmToken: fc.double({ min: 0, max: 10, noNaN: true }),
})
const usageArb = fc.record({
  sttMinutes: fc.double({ min: 0, max: 10000, noNaN: true }),
  llmTokens: fc.double({ min: 0, max: 1_000_000, noNaN: true }),
})

const entryTypeArb = fc.constantFrom<LedgerEntryType>(
  'usage-debit',
  'non-enforced-debit',
  'purchase-credit'
)
const entryArb: fc.Arbitrary<LedgerEntry> = fc.record({
  id: fc.uuid(),
  accountId: fc.constant('acct-1'),
  type: entryTypeArb,
  amount: fc.double({ min: -1000, max: 1000, noNaN: true }),
  createdAt: fc.constant(new Date().toISOString()),
})

// Feature: interview-assistant-saas, Property 1: Credit balance equals the sum of ledger entries
describe('Property 1: credit balance equals the sum of balance-affecting entries', () => {
  it('sums usage-debit and purchase-credit and excludes non-enforced-debit', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 50 }), (entries) => {
        const expected = entries
          .filter((e) => e.type !== 'non-enforced-debit')
          .reduce((s, e) => s + e.amount, 0)
        expect(ledgerBalance(entries)).toBeCloseTo(expected, 6)
      }),
      { numRuns: 300 }
    )
  })

  it('non-enforced-debit entries never change the balance', () => {
    fc.assert(
      fc.property(fc.array(entryArb, { maxLength: 30 }), entryArb, (entries, extra) => {
        const nonEnforced: LedgerEntry = { ...extra, type: 'non-enforced-debit' }
        expect(ledgerBalance([...entries, nonEnforced])).toBeCloseTo(
          ledgerBalance(entries),
          6
        )
      }),
      { numRuns: 200 }
    )
  })
})

// Feature: interview-assistant-saas, Property 3: Conversion_Rate is monotonic and non-negative
describe('Property 3: conversion rate monotonicity and non-negativity', () => {
  it('is always non-negative for non-negative inputs', () => {
    fc.assert(
      fc.property(rateArb, usageArb, (rate, u) => {
        expect(usageToCredits(rate, u)).toBeGreaterThanOrEqual(0)
      }),
      { numRuns: 300 }
    )
  })

  it('is monotonic non-decreasing in each usage component', () => {
    fc.assert(
      fc.property(
        rateArb,
        usageArb,
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 100000, noNaN: true }),
        (rate, u, dMin, dTok) => {
          const bigger = { sttMinutes: u.sttMinutes + dMin, llmTokens: u.llmTokens + dTok }
          expect(usageToCredits(rate, bigger)).toBeGreaterThanOrEqual(
            usageToCredits(rate, u) - 1e-6
          )
        }
      ),
      { numRuns: 300 }
    )
  })
})
