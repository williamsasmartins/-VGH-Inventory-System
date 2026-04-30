import type { Transaction } from '../lib/supabase'

/**
 * A single entry in the per-size stock breakdown.
 * `pieces` is the NET count: sum(IN.sheet_count) − sum(OUT.sheet_count).
 */
export interface StockSizeEntry {
  size: string
  pieces: number
}

/**
 * Reduces a flat transaction list into the *current* stock broken down by size.
 *
 * Rules:
 *  - Transactions without a `sheet_size` or a `sheet_count` are skipped
 *    (they contribute to the raw quantity total but have no size dimension).
 *  - `sheet_count` values that are null, undefined, or ≤ 0 are ignored.
 *  - Sizes whose net balance ≤ 0 are excluded from the result (fully consumed).
 *  - Result is sorted ascending by the numeric part of the size label (e.g. "10'" → 10).
 */
export function calculateStockBySize(transactions: Transaction[]): StockSizeEntry[] {
  const bySize = new Map<string, number>()

  for (const tx of transactions) {
    const size  = tx.sheet_size?.trim()
    const count = tx.sheet_count

    if (!size || count == null || count <= 0) continue

    const delta = tx.type?.toUpperCase() === 'IN' ? count : -count
    bySize.set(size, (bySize.get(size) ?? 0) + delta)
  }

  const result: StockSizeEntry[] = []
  bySize.forEach((pieces, size) => {
    if (pieces > 0) result.push({ size, pieces })
  })

  result.sort((a, b) => parseFloat(a.size) - parseFloat(b.size))
  return result
}

/**
 * Computes the total linear quantity currently in stock from a size breakdown.
 * For each entry: parseFloat(size) × pieces → sum all.
 * Used for the "In Stock" aggregate on linear materials (lnft).
 * Returns 0 if entries is empty or sizes cannot be parsed.
 */
export function calculateTotalFromBreakdown(entries: StockSizeEntry[]): number {
  return entries.reduce((sum, { size, pieces }) => {
    const feet = parseFloat(size)
    return sum + (isNaN(feet) ? 0 : feet * pieces)
  }, 0)
}

/**
 * Computes the total linear quantity received (all IN transactions × size).
 * Formula: sum of (parseFloat(sheet_size) × sheet_count) for every IN transaction
 * that has both `sheet_size` and `sheet_count` set.
 * Used for the "Total In" card on the sidebar when size tracking is active.
 */
export function calculateTotalInFromTransactions(transactions: Transaction[]): number {
  return transactions.reduce((sum, tx) => {
    if (tx.type?.toUpperCase() !== 'IN') return sum
    const size  = tx.sheet_size?.trim()
    const count = tx.sheet_count
    if (!size || count == null || count <= 0) return sum
    const feet = parseFloat(size)
    return sum + (isNaN(feet) ? 0 : feet * count)
  }, 0)
}
