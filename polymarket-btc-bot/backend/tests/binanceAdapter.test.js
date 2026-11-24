import { describe, it, expect } from 'vitest';
import { BinanceAdapter } from '../src/adapters/exchangeAdapter.js';

describe('BinanceAdapter (Live & Paper)', () => {
  it('signs query strings with valid HMAC-SHA256', () => {
    const adapter = new BinanceAdapter();
    const signed = adapter.signQuery(
      { symbol: 'BTCUSDT', side: 'BUY', timestamp: '1700000000000' },
      'test-secret-key'
    );
    expect(signed).toContain('symbol=BTCUSDT&side=BUY&timestamp=1700000000000&signature=');
    const sig = signed.split('signature=')[1];
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
  });

  it('blocks live trading if withdrawals are enabled on the Binance API key', async () => {
    const mockFetch = async (url) => {
      if (url.includes('/sapi/v1/account/apiRestrictions')) {
        return {
          ok: true,
          json: async () => ({ enableWithdrawals: true, enableSpotAndMarginTrading: true }),
        };
      }
      throw new Error('Unexpected call');
    };

    const adapter = new BinanceAdapter({
      useTestnet: false,
      getSecret: (k) => (k === 'BINANCE_API_KEY' ? 'key123' : 'sec123'),
      fetchImpl: mockFetch,
    });

    const res = await adapter.verifyApiKeyAndPermissions();
    expect(res.ok).toBe(false);
    expect(res.withdrawalsDisabled).toBe(false);
    expect(res.reason).toContain('SAFETY BLOCK');
  });

  it('submits signed LIMIT IOC order on live execution with idempotent clientOrderId', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};
    const mockFetch = async (url, opts) => {
      capturedUrl = url;
      capturedHeaders = opts.headers;
      return {
        ok: true,
        json: async () => ({
          orderId: 987654,
          status: 'FILLED',
          executedQty: '0.00052',
          cummulativeQuoteQty: '49.40',
        }),
      };
    };

    const adapter = new BinanceAdapter({
      useTestnet: true,
      getSecret: (k) => (k === 'BINANCE_API_KEY' ? 'my-api-key' : 'my-api-secret'),
      fetchImpl: mockFetch,
    });
    adapter.lastSpotPrice = 95000;

    const res = await adapter.placeLimitOrder({
      isPaper: false,
      side: 'UP',
      sizeUsd: 50,
      shares: 100,
      limitPrice: 0.5,
      maxSlippage: 0.005,
      clientOrderId: 'cid-binance-001',
    });

    expect(res.status).toBe('FILLED');
    expect(res.exchangeOrderId).toBe('987654');
    expect(capturedHeaders['X-MBX-APIKEY']).toBe('my-api-key');
    expect(capturedUrl).toContain('/api/v3/order?');
    expect(capturedUrl).toContain('side=BUY');
    expect(capturedUrl).toContain('type=LIMIT');
    expect(capturedUrl).toContain('timeInForce=IOC');
    expect(capturedUrl).toContain('newClientOrderId=cid-binance-001');
    expect(capturedUrl).toContain('signature=');
  });
});
