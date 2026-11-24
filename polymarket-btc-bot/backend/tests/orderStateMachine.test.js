import { describe, it, expect } from 'vitest';
import {
  OrderManager,
  OrderState,
  TokenBucketRateLimiter,
} from '../src/execution/orderStateMachine.js';

describe('OrderManager & State Machine', () => {
  it('deduplicates orders with the same clientOrderId (idempotency)', () => {
    const om = new OrderManager();
    const first = om.createOrder({
      clientOrderId: 'cid-123',
      windowId: 'w1',
      side: 'UP',
      limitPrice: 0.52,
      sizeUsd: 26,
    });
    const second = om.createOrder({
      clientOrderId: 'cid-123',
      windowId: 'w1',
      side: 'UP',
      limitPrice: 0.52,
      sizeUsd: 26,
    });
    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.order.id).toBe(first.order.id);
  });

  it('rejects invalid state transitions', () => {
    const om = new OrderManager();
    const { order } = om.createOrder({ windowId: 'w1', side: 'UP', limitPrice: 0.5, sizeUsd: 20 });
    expect(() => om.transition(order.id, OrderState.FILLED)).toThrow('Invalid order transition');
  });

  it('retries transient exchange errors and fills', async () => {
    let attempts = 0;
    const mockAdapter = {
      async placeLimitOrder(order) {
        attempts += 1;
        if (attempts < 2) throw new Error('Transient 503');
        return {
          status: 'FILLED',
          exchangeOrderId: 'ex-99',
          filledShares: order.shares,
          avgFillPrice: order.limitPrice,
        };
      },
    };
    const om = new OrderManager({ exchangeAdapter: mockAdapter });
    const { order } = om.createOrder({ windowId: 'w1', side: 'DOWN', limitPrice: 0.48, sizeUsd: 24 });
    const finalOrder = await om.submitOrder(order.id, { maxRetries: 3, baseDelayMs: 5 });
    expect(finalOrder.state).toBe(OrderState.FILLED);
    expect(finalOrder.retries).toBe(1);
    expect(finalOrder.exchangeOrderId).toBe('ex-99');
  });

  it('enforces rate limiter and reconciles partial fills', async () => {
    const limiter = new TokenBucketRateLimiter(1, 0); // only 1 token
    const mockAdapter = {
      async placeLimitOrder() {
        return { status: 'OPEN', exchangeOrderId: 'ex-open' };
      },
    };
    const om = new OrderManager({ exchangeAdapter: mockAdapter, rateLimiter: limiter });
    const { order: o1 } = om.createOrder({ windowId: 'w1', side: 'UP', limitPrice: 0.5, sizeUsd: 50 });
    const { order: o2 } = om.createOrder({ windowId: 'w1', side: 'UP', limitPrice: 0.5, sizeUsd: 50 });

    const r1 = await om.submitOrder(o1.id);
    const r2 = await om.submitOrder(o2.id);
    expect(r1.state).toBe(OrderState.OPEN);
    expect(r2.state).toBe(OrderState.REJECTED);
    expect(r2.errorMessage).toContain('Rate limit');

    // Reconcile partial then full fill on o1
    om.reconcileFill(o1.id, { filledShares: 40, avgFillPrice: 0.5 });
    expect(om.ordersById.get(o1.id).state).toBe(OrderState.PARTIAL_FILL);
    om.reconcileFill(o1.id, { filledShares: 100, avgFillPrice: 0.5 });
    expect(om.ordersById.get(o1.id).state).toBe(OrderState.FILLED);
  });

  it('recovers open orders after restart', () => {
    const om = new OrderManager();
    const recovered = om.recoverOrders([
      { id: 'o1', clientOrderId: 'c1', state: OrderState.OPEN },
      { id: 'o2', clientOrderId: 'c2', state: OrderState.FILLED },
    ]);
    expect(recovered).toHaveLength(1);
    expect(recovered[0].id).toBe('o1');
  });
});
