/**
 * Client-facing re-export of the canonical payout math.
 *
 * The implementation lives under `supabase/functions/_shared` so that the Edge
 * Function which actually writes `bet_ledger_entries` and the app UI that
 * previews payouts run byte-for-byte the same code.
 */
export * from '../../supabase/functions/_shared/payout';
