# Live-trading safety checklist

Live spot trading is disabled by default at three independent layers:

1. Server master switch — `LIVE_TRADING_ENABLED=false`.
2. Per-account consent — `risk/live-opt-in` with the exact phrase `ENABLE LIVE TRADING` **and** a
   risk acknowledgement.
3. Per-order approval — every live order must carry `approved=true`, which the app only sets after the
   user taps through the confirmation dialog.

Saving an API key enables none of these. Automation is a fourth, separate opt-in
(`automation_opt_in`, requires live opt-in first) and is off by default.

Nothing in this app supports futures, margin, leverage or borrowing.

## Before the first live order

- [ ] Backend tests pass: `cd backend && python -m pytest tests`
- [ ] AI engine tests pass: `cd ai-engine && python -m pytest tests`
- [ ] `GET /api/v1/config` shows `binance_environment: live`, `live_trading_enabled: true`
- [ ] `GET /api/v1/risk/status` shows `market.synthetic: false` and `can_trade_live: true`
- [ ] Market data is fresh (dashboard shows no SIMULATED/STALE banner) and the clock is synced
- [ ] API key: spot trading only, withdrawals **disabled**, IP allow-list covering the backend egress
- [ ] No withdrawal permission anywhere; keys stored only in the backend (AES-256-GCM)
- [ ] `REQUIRE_MANUAL_APPROVAL=true`
- [ ] Risk limits set and sane: max trade notional, max exposure %, daily loss, risk per trade %,
      max open orders/positions, mandatory stop-loss, cooldown after losses
- [ ] Full testnet run completed per `docs/TESTNET.md`
- [ ] Paper trading observed for long enough to see the strategy in different regimes
- [ ] Backtest reviewed with fees + slippage, on unseen periods, and with the assumptions/warnings read
- [ ] You accept that signals can be wrong and that stop-losses are not guaranteed protection
- [ ] Emergency stop and admin kill switch drilled (below)

## Emergency-stop drill (do this on testnet first)

1. Open **Risk settings → Emergency stop → Engage**.
2. Expect: live trading disabled, automation off, all open paper + live orders cancelled, an audit
   entry `risk.emergency_stop` with the cancelled ids.
3. Check Binance: no open orders remain for the symbol. Positions are **not** closed automatically —
   that is deliberate.
4. Re-enable only after understanding what triggered it.

Admin equivalent: **Admin → Global kill switch → ENGAGE** blocks live orders for every account and
records `admin.kill_switch`.

## First live orders

- [ ] Start with the smallest notional Binance allows for that symbol
- [ ] Place one `LIMIT` order, confirm it rests, cancel it, confirm `CANCELED`
- [ ] Place one tiny `MARKET` order and verify `FILLED` only after Binance confirms (`UNKNOWN` means
      "not confirmed" — run `POST /orders/reconcile` and check Binance before retrying)
- [ ] Verify the fee recorded matches the exchange
- [ ] Keep the app's Orders screen open for the first sessions; do not rely on notifications alone

## Ongoing discipline

- Never scale size after a winning streak alone; size is bounded by risk limits, not confidence.
- Treat `evidence_grade: weak` and `model_status: untrusted` as "no edge claimed".
- Do not override the risk engine by editing the database; change limits in the UI so the change is
  audited.
- Review weekly: realised P&L net of fees, drawdown, win rate, rejected orders, `UNKNOWN` count.
- Rotate keys per `docs/KEY_ROTATION.md`; revoke immediately if a device is lost.
- Stop trading (kill switch) if: data is stale repeatedly, `UNKNOWN` orders appear, fills differ from
  expectations, or drawdown exceeds your plan.

## What this app will not do

- It will not place an order that failed a risk check, and it will not tell you an order succeeded
  before Binance confirms it.
- It will not invent a confidence percentage, a balance, or an order status.
- It will not guarantee stop-loss execution, and it will not describe stop-losses as guaranteed
  protection.
- It will not request or use withdrawal permission.
- It will not let the AI assistant place, modify or cancel orders.
