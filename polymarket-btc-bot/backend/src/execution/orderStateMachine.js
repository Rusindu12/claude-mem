/**
 * Order State Machine, Idempotency Registry, Rate Limiter, and Fill Reconciliation.
 */
import crypto from 'crypto';

export const OrderState = Object.freeze({
  CREATED: 'CREATED',
  SUBMITTED: 'SUBMITTED',
  OPEN: 'OPEN',
  PARTIAL_FILL: 'PARTIAL_FILL',
  FILLED: 'FILLED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

const VALID_TRANSITIONS = {
  [OrderState.CREATED]: [OrderState.SUBMITTED, OrderState.REJECTED, OrderState.CANCELLED],
  [OrderState.SUBMITTED]: [OrderState.OPEN, OrderState.PARTIAL_FILL, OrderState.FILLED, OrderState.REJECTED, OrderState.CANCELLED],
  [OrderState.OPEN]: [OrderState.PARTIAL_FILL, OrderState.FILLED, OrderState.CANCELLED, OrderState.EXPIRED],
  [OrderState.PARTIAL_FILL]: [OrderState.PARTIAL_FILL, OrderState.FILLED, OrderState.CANCELLED, OrderState.EXPIRED],
  [OrderState.FILLED]: [],
  [OrderState.CANCELLED]: [],
  [OrderState.REJECTED]: [],
  [OrderState.EXPIRED]: [],
};

export class TokenBucketRateLimiter {
  constructor(maxTokens = 10, refillPerSec = 5) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillPerSec = refillPerSec;
    this.lastRefill = Date.now();
  }

  tryAcquire(cost = 1) {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsedSec * this.refillPerSec);
    this.lastRefill = now;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}

export class OrderManager {
  constructor({ exchangeAdapter, rateLimiter } = {}) {
    this.exchangeAdapter = exchangeAdapter;
    this.rateLimiter = rateLimiter || new TokenBucketRateLimiter(15, 5);
    this.ordersById = new Map();
    this.ordersByClientId = new Map();
  }

  createOrder({
    clientOrderId,
    windowId,
    side,
    limitPrice,
    maxSlippage = 0.01,
    sizeUsd,
    isPaper = true,
    exchange = 'polymarket',
  }) {
    const cid = clientOrderId || `${windowId}-${side}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    // Idempotency: return existing order if clientOrderId already exists
    if (this.ordersByClientId.has(cid)) {
      return { order: this.ordersByClientId.get(cid), deduplicated: true };
    }

    const effectiveLimit = Math.min(0.99, Math.max(0.01, limitPrice + maxSlippage));
    const shares = Math.round((sizeUsd / limitPrice) * 10000) / 10000;

    const order = {
      id: `ord_${crypto.randomBytes(6).toString('hex')}`,
      clientOrderId: cid,
      windowId,
      exchange,
      side,
      limitPrice: Math.round(limitPrice * 10000) / 10000,
      effectiveLimitPrice: Math.round(effectiveLimit * 10000) / 10000,
      maxSlippage,
      sizeUsd: Math.round(sizeUsd * 100) / 100,
      shares,
      filledShares: 0,
      avgFillPrice: null,
      state: OrderState.CREATED,
      isPaper,
      exchangeOrderId: null,
      retries: 0,
      errorMessage: null,
      history: [{ state: OrderState.CREATED, ts: Date.now() }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.ordersById.set(order.id, order);
    this.ordersByClientId.set(cid, order);
    return { order, deduplicated: false };
  }

  transition(orderId, nextState, patch = {}) {
    const order = this.ordersById.get(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    const allowed = VALID_TRANSITIONS[order.state] || [];
    if (!allowed.includes(nextState)) {
      throw new Error(`Invalid order transition: ${order.state} -> ${nextState}`);
    }

    Object.assign(order, patch, {
      state: nextState,
      updatedAt: Date.now(),
    });
    order.history.push({ state: nextState, ts: order.updatedAt });
    return order;
  }

  async submitOrder(orderId, { maxRetries = 3, baseDelayMs = 100 } = {}) {
    const order = this.ordersById.get(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);

    if (order.state !== OrderState.CREATED) {
      return order; // Idempotent: already submitted or terminal
    }

    if (!this.rateLimiter.tryAcquire(1)) {
      return this.transition(orderId, OrderState.REJECTED, {
        errorMessage: 'Rate limit exceeded',
      });
    }

    this.transition(orderId, OrderState.SUBMITTED);

    let lastErr = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.exchangeAdapter.placeLimitOrder(order);
        if (res.status === 'FILLED') {
          return this.transition(orderId, OrderState.FILLED, {
            exchangeOrderId: res.exchangeOrderId,
            filledShares: res.filledShares ?? order.shares,
            avgFillPrice: res.avgFillPrice ?? order.limitPrice,
          });
        }
        if (res.status === 'PARTIAL_FILL') {
          return this.transition(orderId, OrderState.PARTIAL_FILL, {
            exchangeOrderId: res.exchangeOrderId,
            filledShares: res.filledShares,
            avgFillPrice: res.avgFillPrice ?? order.limitPrice,
          });
        }
        if (res.status === 'OPEN') {
          return this.transition(orderId, OrderState.OPEN, {
            exchangeOrderId: res.exchangeOrderId,
          });
        }
        return this.transition(orderId, OrderState.REJECTED, {
          errorMessage: res.error || 'Exchange rejected order',
        });
      } catch (err) {
        lastErr = err;
        order.retries = attempt + 1;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
        }
      }
    }

    return this.transition(orderId, OrderState.REJECTED, {
      errorMessage: lastErr?.message || 'Submission failed after retries',
    });
  }

  reconcileFill(orderId, { filledShares, avgFillPrice }) {
    const order = this.ordersById.get(orderId);
    if (!order) throw new Error(`Order not found: ${orderId}`);
    if ([OrderState.FILLED, OrderState.CANCELLED, OrderState.REJECTED, OrderState.EXPIRED].includes(order.state)) {
      return order;
    }
    const nextState = filledShares >= order.shares - 1e-6 ? OrderState.FILLED : OrderState.PARTIAL_FILL;
    return this.transition(orderId, nextState, {
      filledShares: Math.min(order.shares, filledShares),
      avgFillPrice,
    });
  }

  /**
   * Recover in-flight orders after a process restart.
   */
  recoverOrders(persistedOrders = []) {
    for (const o of persistedOrders) {
      this.ordersById.set(o.id, o);
      this.ordersByClientId.set(o.clientOrderId, o);
    }
    return this.getOpenOrders();
  }

  getOpenOrders() {
    return Array.from(this.ordersById.values()).filter((o) =>
      [OrderState.CREATED, OrderState.SUBMITTED, OrderState.OPEN, OrderState.PARTIAL_FILL].includes(o.state)
    );
  }

  getAllOrders() {
    return Array.from(this.ordersById.values()).sort((a, b) => b.createdAt - a.createdAt);
  }
}
