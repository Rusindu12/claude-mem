# Binance testnet workflow

Binance Spot Test Network: <https://testnet.binance.vision/>. It mimics the production REST and
WebSocket APIs with fake balances — the right place to prove order signing, filters, fills and the
user-data stream before any real money is involved.

## 1. Configure the backend for testnet

```bash
BINANCE_ENV=testnet
LIVE_TRADING_ENABLED=true      # only on your testnet deployment
AUTOMATION_ENABLED=false
REQUIRE_MANUAL_APPROVAL=true
MARKET_DATA_MODE=binance
ALLOW_SYNTHETIC_FALLBACK=false
```

`BINANCE_ENV=testnet` switches the client base URL to `https://testnet.binance.vision` and the
WebSocket to `wss://stream.testnet.binance.vision`. Every response labels itself with `environment`
so the app can show `TESTNET`.

Restart the backend, then confirm:

```bash
curl -fsS http://localhost:8000/api/v1/config | jq '.binance_environment, .live_trading_enabled'
```

## 2. Create a testnet key

1. Sign in to <https://testnet.binance.vision/> with GitHub.
2. **Generate HMAC-SHA256 Key** → copy the key and secret.
3. In the app: **More → API connection → paste key + secret → Store key on server**.
4. Tap **Verify**. Expected: `Key verified against Binance` and `status: active`.

No withdrawal permission exists on testnet, and the backend never requests it.

## 3. Prove the basics (paper mode)

| Step | Expected result |
|---|---|
| Dashboard | Connection pill `LIVE`, no `SIMULATED DATA` banner, prices move |
| Markets | Tickers with 24h change and volume; `source: binance` |
| Chart | Candles for 1m…1d, depth and recent trades populated, `stale:false` |
| AI signals | Action + reasons + levels; `model_status` honest (likely `untrusted`) |
| Paper order | Preview shows normalised quantity and passed checks → confirm → status `FILLED` |
| Orders | Order visible with fee; details show `simulated: true` |
| Portfolio | Paper balance reflects the fill minus fees |
| Analytics | Trade counted; win rate/profit factor update |
| Alert | `price_above` alert created; `/alerts/evaluate` can trigger it |
| Assistant | "Summarise BTCUSDT 1h" returns real numbers with `data_as_of` |

## 4. Prove the live path on testnet

1. **Risk settings → Opt in to live spot trading** → type `ENABLE LIVE TRADING`, acknowledge risk.
2. Terminal → mode `LIVE SPOT`.
3. Place a `LIMIT` order below the market (so it rests, unfilled):
   * preview must show `can_place: true`, notional ≤ your max trade size
   * confirmation dialog requires the "real funds" checkbox
   * after placing: status `NEW` (not `FILLED`), `environment: testnet`
4. Cancel it → status `CANCELED`, cancelling is confirmed with the exchange.
5. Place a tiny `MARKET` buy → status `FILLED`, `average_fill_price` and `fee_paid` populated.
6. **Orders → reconcile** → no `UNKNOWN` orders remain.
7. Verify on testnet.binance.vision that the orders exist. Cancel the remainder there if needed.

## 5. Prove the safety rails (do these — they matter more than the happy path)

| Test | Expected |
|---|---|
| Quantity below `minNotional` | 422 `risk_rejected` / validation error, no order sent |
| Price not on the tick size | Preview reports the snapped price in `adjustments` |
| Duplicate identical order within 15s | 409 `conflict`, second order rejected |
| Reuse the same `idempotency_key` | Same order returned, no duplicate |
| Max trade size lowered below the order | 422 with the failing check named |
| Daily loss limit hit | 422 `daily_loss_limit`; orders blocked until the next trading day |
| Stop-loss required but omitted | 422 with `stop_loss_required` |
| Emergency stop | Live trading off, open orders cancelled, audit entry present |
| Admin kill switch | Live orders blocked for everyone until released |
| Disable network → place order | Preview fails with a market-data error; nothing is sent |
| Stale data (`MARKET_STALE_AFTER_SECONDS` lowered) | Risk blocks live orders with `stale_market_data` |

## 6. User-data stream

With `BINANCE_USER_STREAM_ENABLED=true` the backend keeps a listen-key stream open per credential and
records fills/cancels. To test:

1. Place and cancel orders while watching `docker compose logs -f backend`.
2. Expect `listenKey` creation, `executionReport` handling, and notification rows for fills/cancels.
3. The app shows these under **More → Notifications**.

If you see repeated listen-key reconnects, check clock skew (`/api/v3/time` vs server time) and the
egress IP allow-list.

## 7. Moving to live (only after all of the above)

1. Create a **production** key: spot trading enabled, **withdrawals disabled**, IP allow-listed.
2. `BINANCE_ENV=live`, keep `REQUIRE_MANUAL_APPROVAL=true`.
3. Start with the smallest size Binance allows and watch the first several orders manually.
4. Keep `AUTOMATION_ENABLED=false` until paper + testnet results justify otherwise.
5. Re-read [`LIVE_TRADING_SAFETY.md`](LIVE_TRADING_SAFETY.md) and complete every checkbox.

## 8. Automated tests and the network

The automated suite never touches the real exchange. `backend/tests/test_binance_client.py` and
`test_live_order_flow.py` inject `httpx.MockTransport`/fake clients to assert signing, error mapping
and the "no optimistic success" rule. Do not "fix" failing tests by pointing them at testnet: that
would make the suite depend on the internet and could place real orders.

The build environment used to create this project could not reach `api.binance.com` (TLS blocked),
so **no live or testnet exchange call has been verified from here**. Steps 1–6 above are the
verification you must run yourself.
