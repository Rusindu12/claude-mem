/**
 * Express + Socket.io Backend Server for Polymarket 5m BTC Trading Bot.
 */
import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';

import { SpotFeed } from './services/spotFeed.js';
import { PolymarketAdapter, BinanceAdapter } from './adapters/exchangeAdapter.js';
import { RiskManager } from './risk/riskManager.js';
import { OrderManager } from './execution/orderStateMachine.js';
import { BotEngine } from './services/botEngine.js';
import { replaySnapshots } from './services/analytics.js';
import { encryptSecret, decryptSecret } from './security/crypto.js';
import {
  verifyCredentials,
  verifyTotp,
  getTotpSetupUri,
  signToken,
  authMiddleware,
} from './security/auth.js';

const PORT = Number(process.env.PORT || 4000);
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: true, credentials: true },
  path: '/socket.io',
});

// In-memory encrypted secrets vault (backed by PostgreSQL `encrypted_secrets` in Docker)
const encryptedVault = new Map();

function resolveSecret(name) {
  const entry = encryptedVault.get(name);
  if (entry) {
    return decryptSecret(entry);
  }
  return process.env[name] || null;
}

// Core services
const spotFeed = new SpotFeed();
const polymarketAdapter = new PolymarketAdapter();
const binanceAdapter = new BinanceAdapter({ getSecret: resolveSecret });
let activeExchange = process.env.EXCHANGE === 'binance' ? 'binance' : 'polymarket';
const initialAdapter = activeExchange === 'binance' ? binanceAdapter : polymarketAdapter;

const riskManager = new RiskManager();
const orderManager = new OrderManager({ exchangeAdapter: initialAdapter });
const botEngine = new BotEngine({
  spotFeed,
  exchangeAdapter: initialAdapter,
  riskManager,
  orderManager,
});

// --- Auth Routes (JWT + 2FA TOTP) ---
app.post('/api/auth/login', (req, res) => {
  const { username, password, totpCode } = req.body || {};
  if (!verifyCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  if (!verifyTotp(totpCode)) {
    return res.status(401).json({ error: 'Invalid 2FA TOTP code' });
  }
  const token = signToken({ username, role: 'trader' });
  return res.json({ token, username, totpVerified: true });
});

app.get('/api/auth/2fa-setup', authMiddleware, (_req, res) => {
  res.json({ otpauthUri: getTotpSetupUri() });
});

// --- Health & State ---
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    dryRun: riskManager.config.dryRun,
    liveModeActive: riskManager.isLiveExecutionAllowed(),
    killSwitchActive: riskManager.killSwitchActive,
    uptimeSec: Math.floor(process.uptime()),
  });
});

app.get('/api/state', (_req, res) => {
  res.json(botEngine.getSnapshotState());
});

// --- Kill Switch (UI & API) ---
app.post('/api/kill-switch', (req, res) => {
  const { active, reason } = req.body || {};
  if (active) {
    riskManager.triggerKillSwitch(reason || 'Manual kill switch triggered via API/UI');
  } else {
    riskManager.resetKillSwitch();
  }
  const state = botEngine.getSnapshotState();
  io.emit('state', state);
  res.json({ ok: true, risk: state.risk });
});

// --- Live Trading Safety Gate ---
app.post('/api/safety/live-mode', authMiddleware, (req, res) => {
  const { enabled, confirmationPhrase, totpCode } = req.body || {};
  if (enabled && !verifyTotp(totpCode)) {
    return res.status(401).json({ ok: false, reason: 'Valid 2FA code required to enable live trading' });
  }
  const result = riskManager.setUiLiveConfirmation(Boolean(enabled), confirmationPhrase);
  const state = botEngine.getSnapshotState();
  io.emit('state', state);
  return res.status(result.ok ? 200 : 400).json({ ...result, risk: state.risk });
});

// --- Encrypted Secrets Vault (write-only from API; never returned or logged) ---
app.post('/api/secrets', authMiddleware, (req, res) => {
  const { name, value } = req.body || {};
  if (!name || !value) {
    return res.status(400).json({ error: 'name and value required' });
  }
  const encrypted = encryptSecret(String(value));
  encryptedVault.set(name, { ...encrypted, updatedAt: Date.now() });
  return res.json({ ok: true, name, stored: true, algorithm: 'aes-256-gcm' });
});

app.get('/api/secrets', authMiddleware, (_req, res) => {
  // Never return ciphertext or plaintext — only key names and metadata
  const keys = Array.from(encryptedVault.entries()).map(([name, meta]) => ({
    name,
    updatedAt: meta.updatedAt,
    encrypted: true,
  }));
  res.json({ keys });
});

// --- Exchange Selection (Polymarket or Binance) ---
app.post('/api/exchange', authMiddleware, (req, res) => {
  const { exchange, useTestnet } = req.body || {};
  if (!['polymarket', 'binance'].includes(exchange)) {
    return res.status(400).json({ ok: false, error: 'exchange must be "polymarket" or "binance"' });
  }
  if (exchange === 'binance' && typeof useTestnet === 'boolean') {
    binanceAdapter.useTestnet = useTestnet;
    binanceAdapter.baseUrl = useTestnet
      ? 'https://testnet.binance.vision'
      : 'https://api.binance.com';
  }
  activeExchange = exchange;
  const adapter = exchange === 'binance' ? binanceAdapter : polymarketAdapter;
  orderManager.exchangeAdapter = adapter;
  botEngine.exchangeAdapter = adapter;
  const state = botEngine.getSnapshotState();
  io.emit('state', state);
  return res.json({
    ok: true,
    activeExchange,
    binanceTestnet: binanceAdapter.useTestnet,
  });
});

// --- Binance API Key & Permissions Verification (checks withdrawals disabled!) ---
app.post('/api/binance/verify', authMiddleware, async (_req, res) => {
  try {
    const result = await binanceAdapter.verifyApiKeyAndPermissions();
    return res.status(result.ok ? 200 : 400).json(result);
  } catch (err) {
    return res.status(400).json({ ok: false, reason: err.message });
  }
});

// --- Analytics & Threshold Replay ---
app.get('/api/replay', (req, res) => {
  const edgeThreshold = Number(req.query.edgeThreshold ?? botEngine.edgeThreshold);
  const result = replaySnapshots(botEngine.snapshots, {
    edgeThreshold,
    feeRate: botEngine.feeRate,
    slippageEst: botEngine.slippageEst,
  });
  res.json(result);
});

// --- Socket.io Real-time Updates ---
botEngine.on('state', (state) => {
  io.emit('state', state);
});

io.on('connection', (socket) => {
  socket.emit('state', botEngine.getSnapshotState());
});

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`[Backend] Listening on http://0.0.0.0:${PORT} (DRY_RUN=${riskManager.config.dryRun})`);
  await botEngine.start();
});
