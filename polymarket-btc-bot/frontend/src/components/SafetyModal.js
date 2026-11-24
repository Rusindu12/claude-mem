'use client';

import { useState } from 'react';
import { ShieldAlert, Lock, X, CheckCircle2, RefreshCw } from 'lucide-react';

export default function SafetyModal({
  open,
  onClose,
  risk,
  activeExchange = 'polymarket',
  authToken,
  onAuthSuccess,
}) {
  const [username, setUsername] = useState('trader');
  const [password, setPassword] = useState('paper-mode-2026');
  const [totpCode, setTotpCode] = useState('000000');
  const [phrase, setPhrase] = useState('');
  const [selectedExchange, setSelectedExchange] = useState(activeExchange);
  const [binanceTestnet, setBinanceTestnet] = useState(true);
  const [secretName, setSecretName] = useState('BINANCE_API_KEY');
  const [secretVal, setSecretVal] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [msg, setMsg] = useState(null);

  if (!open) return null;

  const handleLogin = async (e) => {
    e.preventDefault();
    setMsg(null);
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, totpCode }),
    });
    const data = await resp.json();
    if (resp.ok && data.token) {
      onAuthSuccess(data.token);
      setMsg({ ok: true, text: 'Authenticated with JWT + 2FA.' });
    } else {
      setMsg({ ok: false, text: data.error || 'Login failed' });
    }
  };

  const handleSwitchExchange = async (exchange, testnet = binanceTestnet) => {
    setSelectedExchange(exchange);
    setMsg(null);
    const resp = await fetch('/api/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ exchange, useTestnet: testnet }),
    });
    const data = await resp.json();
    if (resp.ok) {
      setMsg({
        ok: true,
        text: `Active exchange set to ${data.activeExchange.toUpperCase()}${
          data.activeExchange === 'binance' ? (data.binanceTestnet ? ' (Testnet)' : ' (Live Spot)') : ''
        }.`,
      });
    } else {
      setMsg({ ok: false, text: data.error || 'Failed to switch exchange' });
    }
  };

  const handleVerifyBinance = async () => {
    setVerifying(true);
    setMsg(null);
    try {
      const resp = await fetch('/api/binance/verify', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await resp.json();
      if (resp.ok && data.ok) {
        const balStr = (data.balances || []).map((b) => `${b.asset}: ${b.free}`).join(', ');
        setMsg({
          ok: true,
          text: `Binance key verified! Withdrawals disabled: YES. Balances: ${balStr || '0'}`,
        });
      } else {
        setMsg({ ok: false, text: data.reason || 'Binance verification failed' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleToggleLive = async (enabled) => {
    setMsg(null);
    const resp = await fetch('/api/safety/live-mode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ enabled, confirmationPhrase: phrase, totpCode }),
    });
    const data = await resp.json();
    setMsg({
      ok: Boolean(data.ok),
      text: data.reason || (enabled ? 'Live mode enabled' : 'Reverted to paper mode'),
    });
  };

  const handleSaveSecret = async (e) => {
    e.preventDefault();
    setMsg(null);
    const resp = await fetch('/api/secrets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ name: secretName, value: secretVal }),
    });
    const data = await resp.json();
    if (resp.ok) {
      setSecretVal('');
      setMsg({
        ok: true,
        text: `Stored ${secretName} encrypted (AES-256-GCM). Never returned to browser.`,
      });
    } else {
      setMsg({ ok: false, text: data.error || 'Failed to store secret' });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-amber-500" />
            <h2 className="font-semibold text-base">Security, Exchange & Live Trading Gate</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="w-4 h-4" />
          </button>
        </div>

        {msg && (
          <div
            className={`text-xs px-3 py-2 rounded-lg border ${
              msg.ok
                ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300'
                : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'
            }`}
          >
            {msg.text}
          </div>
        )}

        {!authToken ? (
          <form onSubmit={handleLogin} className="space-y-3">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sign in with JWT + TOTP 2FA to configure Binance API keys, switch exchanges, or manage live trading gates. (Paper-mode dev default:{' '}
              <span className="font-mono">trader / paper-mode-2026 / 000000</span>)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Username"
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent"
              />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent"
              />
            </div>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="2FA TOTP Code (6 digits)"
              className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent"
            />
            <button
              type="submit"
              className="w-full py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-700 text-white"
            >
              Authenticate (JWT + 2FA)
            </button>
          </form>
        ) : (
          <div className="space-y-4">
            {/* Exchange Selector */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span>Execution Exchange</span>
                <span className="font-mono uppercase text-sky-600 dark:text-sky-400">{selectedExchange}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleSwitchExchange('polymarket')}
                  className={`py-1.5 text-xs font-semibold rounded border ${
                    selectedExchange === 'polymarket'
                      ? 'bg-sky-600 text-white border-sky-600'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  Polymarket CLOB
                </button>
                <button
                  onClick={() => handleSwitchExchange('binance', binanceTestnet)}
                  className={`py-1.5 text-xs font-semibold rounded border ${
                    selectedExchange === 'binance'
                      ? 'bg-amber-500 text-white border-amber-500'
                      : 'border-slate-300 dark:border-slate-700'
                  }`}
                >
                  Binance Spot API
                </button>
              </div>
              {selectedExchange === 'binance' && (
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={binanceTestnet}
                      onChange={(e) => {
                        setBinanceTestnet(e.target.checked);
                        handleSwitchExchange('binance', e.target.checked);
                      }}
                    />
                    Use Binance Testnet (recommended first)
                  </label>
                  <button
                    onClick={handleVerifyBinance}
                    disabled={verifying}
                    className="flex items-center gap-1 text-[11px] font-semibold text-sky-600 hover:underline"
                  >
                    <RefreshCw className={`w-3 h-3 ${verifying ? 'animate-spin' : ''}`} />
                    Verify Key
                  </button>
                </div>
              )}
            </div>

            {/* Encrypted Secrets Vault */}
            <form onSubmit={handleSaveSecret} className="space-y-2 border-t border-slate-200 dark:border-slate-800 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Lock className="w-3.5 h-3.5 text-teal-600" />
                <span>AES-256-GCM Encrypted Secrets Vault</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                For Binance live trading, store both <span className="font-mono">BINANCE_API_KEY</span> and{' '}
                <span className="font-mono">BINANCE_API_SECRET</span> (with withdrawals disabled).
              </p>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-transparent"
                >
                  <option value="BINANCE_API_KEY">BINANCE_API_KEY</option>
                  <option value="BINANCE_API_SECRET">BINANCE_API_SECRET</option>
                  <option value="POLYMARKET_PRIVATE_KEY">POLYMARKET_PRIVATE_KEY</option>
                  <option value="POLYMARKET_CLOB_API_KEY">POLYMARKET_CLOB_API_KEY</option>
                </select>
                <input
                  type="password"
                  value={secretVal}
                  onChange={(e) => setSecretVal(e.target.value)}
                  placeholder="Secret value (write-only)"
                  className="px-2.5 py-1.5 text-xs rounded border border-slate-300 dark:border-slate-700 bg-transparent"
                />
              </div>
              <button
                type="submit"
                className="w-full py-1.5 text-xs font-semibold rounded bg-teal-600 hover:bg-teal-700 text-white flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Encrypt & Store Secret
              </button>
            </form>

            {/* Live Trading Safety Gate */}
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Execution Mode</span>
                <span className={`font-mono font-bold ${risk?.liveModeActive ? 'text-red-600' : 'text-teal-600'}`}>
                  {risk?.liveModeActive ? 'LIVE TRADING' : 'PAPER (DRY_RUN)'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Live orders require <span className="font-mono">DRY_RUN=false</span>,{' '}
                <span className="font-mono">LIVE_TRADING=true</span> on the server, a valid 2FA code, and typing the exact confirmation phrase below.
              </p>
              <input
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder='Type: I UNDERSTAND LIVE TRADING RISK'
                className="w-full px-2.5 py-1.5 text-xs font-mono rounded border border-slate-300 dark:border-slate-700 bg-transparent"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggleLive(true)}
                  className="flex-1 py-1.5 text-xs font-semibold rounded bg-red-600 hover:bg-red-700 text-white"
                >
                  Enable Live Gate
                </button>
                <button
                  onClick={() => handleToggleLive(false)}
                  className="flex-1 py-1.5 text-xs font-semibold rounded bg-slate-200 dark:bg-slate-700"
                >
                  Force Paper Mode
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
