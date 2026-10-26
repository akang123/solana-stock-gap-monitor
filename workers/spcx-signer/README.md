# SPCX Payout Safety

## Daily budget

The approved budget is $30 per UTC day. Configure `DAILY_PAYOUT_CAP_USD_CENTS=3000` on both `stock-gap-maze-counter` and `stock-gap-spcx-signer`. The amount is expressed in USD cents; either Worker reports payouts inactive when the value is missing or invalid.

The budget uses UTC calendar days. D1 reserves a claim's USD value before the signer is called, counts pending reservations and confirmed payouts against the cap, moves confirmed payouts from reserved to paid, and releases a reservation only after an on-chain failure. SQLite triggers perform those changes in the same transaction as each claim-state change, so concurrent claims cannot over-reserve the daily budget.

The signer independently checks that the claim has a valid reservation, that aggregate reserved-plus-paid value remains within the configured cap, and that the SPCX units match the stored Backpack quote and USD reward. Keep the cap identical in both Workers and avoid changing it mid-UTC-day.

## Transaction expiry recovery

Apply migration `0006_add_blockhash_expiry_recovery.sql` before deploying the signer update. New signed claims persist `last_valid_block_height` with the signature and wire transaction. On retry, the signer compares finalized block height with that bound and searches signature history before releasing an expired reservation. Configure `SIGNATURE_HISTORY_COMPLETE=true` only when `SOLANA_RPC_URL` points to an endpoint with complete historical signature lookup; the signer reports inactive without this explicit assertion. If history is unavailable or inconclusive, the claim stays pending and its reservation stays held. Claims signed before migration have no saved validity height and require manual reconciliation; the signer will not rebuild them automatically.

Apply all D1 migrations through `0006_add_blockhash_expiry_recovery.sql` before enabling payouts. Keep `REWARDS_ENABLED` set to `false` until production secrets/RPC history, migrations, and treasury funding are verified.
