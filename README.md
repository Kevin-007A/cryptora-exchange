# CRYPTORA v2 — English Only Test Exchange

## User frontend
- Professional exchange-style UI with light/dark mode.
- Live crypto market data from CoinGecko.
- Top 100 market-cap ranking.
- No fake/random fallback prices: if live data is unavailable, the UI says so.
- CRYPTORA custom assets are merged and ranked by market cap.
- Test Buy/Sell engine with 0.10% fee.
- USD wallet, portfolio and order history.
- Deposit/Withdraw entry points prepared for the admin-managed network QR/address flow.

## Admin
The admin dashboard remains separate from the user site. Custom assets can be configured there.

## Production note
This is still a test exchange. Before handling real funds, add Supabase Auth, strict RLS/server-side authorization, an auditable ledger, secure deposit/withdrawal processing, blockchain/payment integrations, and applicable compliance controls.
