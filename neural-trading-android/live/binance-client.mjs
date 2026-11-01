/* Binance REST signing transport. Not wired to the app or an order bot.
 * API secrets remain in memory. Never print keys, signatures or request URLs.
 * Callers must reconcile ambiguous failures before retrying an order.
 */
const ENDPOINTS = Object.freeze({
  spot: { testnet: 'https://testnet.binance.vision', live: 'https://api.binance.com' },
  futures: { testnet: 'https://testnet.binancefuture.com', live: 'https://fapi.binance.com' }
});
const ALLOWED = Object.freeze({
  spot: new Set(['GET /api/v3/account', 'GET /api/v3/openOrders', 'GET /api/v3/order', 'POST /api/v3/order/test', 'POST /api/v3/order', 'DELETE /api/v3/order']),
  futures: new Set(['GET /fapi/v2/account', 'GET /fapi/v2/positionRisk', 'GET /fapi/v1/openOrders', 'GET /fapi/v1/order', 'POST /fapi/v1/order/test', 'POST /fapi/v1/order', 'DELETE /fapi/v1/order'])
});

export async function hmacHex(secret, message, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error('Web Crypto is unavailable');
  const encoder = new TextEncoder();
  const key = await subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await subtle.sign('HMAC', key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, '0')).join('');
}

export function createBinanceClient({ market, environment, apiKey, apiSecret, fetchImpl = globalThis.fetch, clock = Date.now, subtle = globalThis.crypto?.subtle }) {
  if (!Object.hasOwn(ENDPOINTS, market) || !Object.hasOwn(ENDPOINTS[market], environment)) throw new Error('Invalid Binance environment');
  if (typeof apiKey !== 'string' || !apiKey.trim() || typeof apiSecret !== 'string' || !apiSecret.trim()) throw new Error('API key and secret are required');
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable');
  const origin = ENDPOINTS[market][environment];
  let key = apiKey.trim(), secret = apiSecret.trim();
  return Object.freeze({
    // Clearing references is best effort; JavaScript strings cannot be securely erased.
    clear() { key = ''; secret = ''; },
    async request(method, path, params = {}) {
      if (!key || !secret) throw new Error('Client credentials cleared');
      if (!ALLOWED[market].has(`${method} ${path}`)) throw new Error('Endpoint not allowed');
      if (!params || Object.getPrototypeOf(params) !== Object.prototype) throw new Error('Invalid parameters');
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(params)) {
        if (!/^[A-Za-z][A-Za-z0-9]*$/.test(name) || ['timestamp', 'signature', 'recvWindow'].includes(name)) throw new Error('Invalid parameter name');
        if (!['string', 'number', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('Invalid parameter value');
        query.append(name, String(value));
      }
      query.append('recvWindow', '5000');
      query.append('timestamp', String(Math.floor(clock())));
      const payload = query.toString();
      query.append('signature', await hmacHex(secret, payload, subtle));
      // No automatic retry: a timeout after order submission has an unknown outcome.
      let response;
      try { response = await fetchImpl(`${origin}${path}?${query}`, { method, headers: { 'X-MBX-APIKEY': key }, cache: 'no-store', redirect: 'error' }); }
      catch (_) { throw new Error('Network request failed; order status may be unknown. Reconcile before retrying.'); }
      let result;
      try { result = await response.json(); } catch (_) { throw new Error(`Invalid Binance response (HTTP ${response.status}); reconcile order status before retrying.`); }
      if (!response.ok || (result && typeof result.code === 'number' && result.code < 0)) {
        const code = Number.isFinite(result?.code) ? ` (code ${result.code})` : '';
        throw new Error(`Binance request failed${code}; HTTP ${response.status}. Reconcile order status before retrying.`);
      }
      return result;
    }
  });
}
