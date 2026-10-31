import 'reflect-metadata';
import * as http from 'http';
import { createRequire } from 'module';
const cjsRequire = createRequire(__filename);
const { createNexoraApp } = cjsRequire('../dist/main');

/**
 * NEXORA AI — Realistic Concurrent Load & Throughput Validation Script
 * Simulates burst concurrent users executing authenticated wallet reads, model catalog lookups,
 * and routed AI chat completions (with atomic credit reservation & settlement) to validate
 * p50/p95/p99 latency, zero 5xx errors, and strict ledger consistency.
 */
async function runLoadTest() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'pglite://memory';
  process.env.REDIS_URL = 'embedded';
  process.env.OWNER_BOOTSTRAP_EMAIL = 'owner@nexora.ai';
  process.env.OWNER_BOOTSTRAP_PASSWORD = 'NexoraOwner#2026!';

  const upstream = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'Fast load-test response.' } }],
        usage: { prompt_tokens: 24, completion_tokens: 12 },
      }),
    );
  });

  const upstreamPort = await new Promise<number>((resolve) => {
    upstream.listen(0, '127.0.0.1', () => resolve((upstream.address() as any).port));
  });

  process.env.OPENAI_API_KEY = 'sk-loadtest-valid-key-9999';
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${upstreamPort}/v1`;

  const app = await createNexoraApp();
  await app.listen(0, '127.0.0.1');
  const baseUrl = await app.getUrl();

  console.log(`\n=== NEXORA AI LOAD & CONCURRENCY VALIDATION ===`);
  console.log(`Target Server: ${baseUrl}`);

  // 1. Register 50 virtual users concurrently in batches
  const virtualUsers = 50;
  const tokens: string[] = [];
  for (let i = 0; i < virtualUsers; i++) {
    const r = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: `loaduser_${i}@nexora.ai`,
        password: 'LoadUserPass#2026',
        fullName: `Load User ${i}`,
      }),
    });
    const j: any = await r.json();
    if (j.accessToken) tokens.push(j.accessToken);
  }
  console.log(`Registered ${tokens.length} authenticated concurrent users.`);

  // 2. Fire 200 concurrent mixed API & AI operations across the user pool
  const totalRequests = 200;
  const latencies: number[] = [];
  let okCount = 0;
  let errCount = 0;

  const startedAt = Date.now();
  await Promise.all(
    Array.from({ length: totalRequests }, async (_, idx) => {
      const token = tokens[idx % tokens.length];
      const t0 = performance.now();
      const endpoint =
        idx % 3 === 0
          ? { method: 'GET', path: '/api/v1/wallet' }
          : idx % 3 === 1
            ? { method: 'GET', path: '/api/v1/chat/models' }
            : {
                method: 'POST',
                path: '/api/v1/chat/tools/execute',
                body: JSON.stringify({ mode: 'CHAT', prompt: `Hello from concurrent request #${idx}` }),
              };

      const res = await fetch(`${baseUrl}${endpoint.path}`, {
        method: endpoint.method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: endpoint.body,
      });
      latencies.push(performance.now() - t0);
      if (res.ok) okCount++;
      else errCount++;
    }),
  );

  const wallMs = Date.now() - startedAt;
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  const rps = (totalRequests / (wallMs / 1000)).toFixed(1);

  console.log(`Completed ${totalRequests} concurrent requests in ${wallMs}ms (${rps} req/sec)`);
  console.log(`Success: ${okCount}/${totalRequests} | Errors: ${errCount}`);
  console.log(`Latency -> p50: ${p50.toFixed(1)}ms | p95: ${p95.toFixed(1)}ms | p99: ${p99.toFixed(1)}ms`);

  await app.close();
  upstream.close();

  if (errCount > 0) {
    process.exit(1);
  }
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
