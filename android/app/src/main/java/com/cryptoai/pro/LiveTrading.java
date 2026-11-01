package com.cryptoai.pro;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Exchange-aware live trading layer.
 *
 * The web UI never talks to the exchange with credentials directly: it calls
 * these helpers, the request is signed here, and the result is normalised into
 * one shape for Binance spot and Bybit v5 spot:
 *
 *   { ok, status, error, retryable, rateLimited, retryAfterMs, orderId, clientId,
 *     execQty, cumQuote, fills[], code, msg, raw }
 */
final class LiveTrading {

    private LiveTrading() {}

    /** Called for every signed request; returns the normalised envelope. */
    static String request(Keys keys, String exchange, String method, String path, String paramsJson) {
        String ex = "bybit".equals(exchange) ? "bybit" : "binance";
        try {
            String apiKey = keys.key(ex);
            String secret = keys.secret(ex);
            if (apiKey == null || apiKey.isEmpty() || secret == null || secret.isEmpty()) {
                return fail(null, "no_" + ex + "_keys", "No " + ex + " API keys saved");
            }
            JSONObject params = (paramsJson == null || paramsJson.trim().isEmpty()) ? new JSONObject() : new JSONObject(paramsJson);
            boolean testnet = keys.testnet(ex);
            Http.Req req = "bybit".equals(ex)
                    ? Bybit.signedRequest(apiKey, secret, testnet, method, path, params)
                    : Binance.signedRequest(apiKey, secret, testnet, method, path, params);
            return normalise(ex, Http.send(req));
        } catch (Exception e) {
            return fail(null, "request_failed", String.valueOf(e.getMessage()));
        }
    }

    /** One round trip used by the Settings "Test connection" button. */
    static String selfTest(Keys keys, String exchange) {
        String ex = "bybit".equals(exchange) ? "bybit" : "binance";
        long t0 = System.currentTimeMillis();
        try {
            String apiKey = keys.key(ex);
            String secret = keys.secret(ex);
            if (apiKey == null || apiKey.isEmpty() || secret == null || secret.isEmpty()) {
                return fail(null, "no_keys", "No " + ex + " API keys saved");
            }
            boolean testnet = keys.testnet(ex);
            Http.Req req = "bybit".equals(ex)
                    ? Bybit.signedRequest(apiKey, secret, testnet, "GET", "/v5/account/wallet-balance",
                    new JSONObject().put("accountType", "UNIFIED"))
                    : Binance.signedRequest(apiKey, secret, testnet, "GET", "/api/v3/account", new JSONObject());
            Http.Resp resp = Http.send(req);
            JSONObject out = new JSONObject(normalise(ex, resp));
            out.put("latencyMs", System.currentTimeMillis() - t0);
            out.put("testnet", testnet);
            out.put("base", keys.base(ex));
            try {
                Object perms = null;
                JSONObject j = resp.json();
                if (j != null) {
                    if ("binance".equals(ex)) {
                        perms = j.opt("permissions");
                        if (j.has("canTrade")) out.put("canTrade", j.optBoolean("canTrade", false));
                        if (j.has("canWithdraw")) out.put("canWithdraw", j.optBoolean("canWithdraw", false));
                    } else {
                        JSONArray list = j.optJSONObject("result") == null ? null : j.optJSONObject("result").optJSONArray("list");
                        if (list != null && list.length() > 0) perms = list.optJSONObject(0).opt("permissions");
                    }
                }
                if (perms != null) out.put("permissions", perms);
            } catch (Exception ignored) {
            }
            return out.toString();
        } catch (Exception e) {
            return fail(null, "selftest_failed", String.valueOf(e.getMessage()));
        }
    }

    /* ------------------------------------------------------------ mapping */

    static String normalise(String ex, Http.Resp resp) {
        JSONObject out = new JSONObject();
        try {
            out.put("status", resp.status);
            out.put("ok", resp.ok() && !hasExchangeError(ex, resp));
            out.put("error", !out.optBoolean("ok"));
            out.put("retryable", resp.status == 0 || resp.status == 408 || resp.status == 429 || resp.status >= 500);
            out.put("rateLimited", resp.status == 429 || isRateLimited(ex, resp));
            long retryAfter = -1;
            for (Map.Entry<String, String> e : resp.headers.entrySet()) {
                String k = e.getKey() == null ? "" : e.getKey().toLowerCase();
                if (k.equals("retry-after") || k.contains("used-weight-1m") || k.contains("ratelimit")) {
                    try {
                        retryAfter = Math.max(retryAfter, (long) (Double.parseDouble(e.getValue().trim()) * 1000));
                    } catch (Exception ignored) {
                    }
                }
            }
            out.put("retryAfterMs", retryAfter);

            JSONObject j = resp.json();
            if (j == null) {
                out.put("ok", false);
                out.put("error", true);
                out.put("code", "bad_json");
                out.put("msg", resp.body == null ? "" : truncate(resp.body, 200));
                out.put("raw", resp.body == null ? "" : truncate(resp.body, 4000));
                return out.toString();
            }
            out.put("raw", resp.body == null ? "" : truncate(resp.body, 8000));

            if ("bybit".equals(ex)) {
                out.put("code", j.optString("retCode", "0"));
                out.put("msg", j.optString("retMsg", ""));
                JSONObject result = j.optJSONObject("result");
                fillOrder(out, result, true);
                if ("10006".equals(j.optString("retCode")) || "10018".equals(j.optString("retCode"))) {
                    out.put("rateLimited", true);
                }
            } else {
                boolean statusOk = j.optBoolean("success", !j.has("code") || j.optInt("code") < 0 ? false : true);
                out.put("code", j.optString("code", j.has("code") ? "" : "0"));
                out.put("msg", j.optString("msg", ""));
                if (j.has("code") && j.optInt("code") < 0) {
                    out.put("ok", false);
                    out.put("error", true);
                    boolean rl = j.optInt("code") == -1003 || j.optInt("code") == -1015;
                    if (rl) out.put("rateLimited", true);
                    if (j.optInt("code") == -1021) out.put("clockSkew", true);
                    if (j.optInt("code") == -2010 || j.optInt("code") == -2015) out.put("authFailed", true);
                }
                if (j.has("orderId")) {
                    fillOrder(out, j, false);
                } else if (j.has("balances") || j.has("accountType")) {
                    out.put("account", true);
                } else if (j.has("symbols")) {
                    out.put("symbols", j.opt("symbols"));
                }
            }
        } catch (Exception e) {
            try {
                out.put("ok", false);
                out.put("error", true);
                out.put("msg", "parse: " + String.valueOf(e.getMessage()));
            } catch (Exception ignored) {
            }
        }
        return out.toString();
    }

    private static void fillOrder(JSONObject out, JSONObject o, boolean bybit) {
        if (o == null) return;
        try {
            if (bybit) {
                if (o.has("orderId")) out.put("orderId", o.optString("orderId"));
                if (o.has("orderLinkId")) out.put("clientId", o.optString("orderLinkId"));
                if (o.has("cumExecQty")) out.put("execQty", o.optString("cumExecQty"));
                if (o.has("avgPrice")) out.put("avgPrice", o.optString("avgPrice"));
                if (o.has("orderStatus")) out.put("orderStatus", o.optString("orderStatus"));
                if (o.has("list")) out.put("list", o.opt("list"));
            } else {
                out.put("orderId", o.optString("orderId"));
                out.put("clientId", o.optString("clientOrderId"));
                out.put("execQty", o.optString("executedQty", "0"));
                out.put("cumQuote", o.optString("cummulativeQuoteQty", "0"));
                out.put("avgPrice", o.optString("avgPrice", "0"));
                out.put("orderStatus", o.optString("status", ""));
                out.put("transactTime", o.optLong("transactTime", 0));
                JSONArray fills = o.optJSONArray("fills");
                if (fills != null) {
                    JSONArray f = new JSONArray();
                    for (int i = 0; i < fills.length(); i++) {
                        JSONObject x = fills.optJSONObject(i);
                        if (x == null) continue;
                        f.put(new JSONObject()
                                .put("price", x.optString("price"))
                                .put("qty", x.optString("qty"))
                                .put("commission", x.optString("commission"))
                                .put("commissionAsset", x.optString("commissionAsset"))
                                .put("tradeId", x.optString("tradeId")));
                    }
                    out.put("fills", f);
                }
            }
        } catch (Exception ignored) {
        }
    }

    private static boolean hasExchangeError(String ex, Http.Resp resp) {
        JSONObject j = resp.json();
        if (j == null) return true;
        if ("bybit".equals(ex)) return j.optInt("retCode", 0) != 0;
        return j.has("code") && j.optInt("code") < 0;
    }

    private static boolean isRateLimited(String ex, Http.Resp resp) {
        JSONObject j = resp.json();
        if (j == null) return false;
        if ("bybit".equals(ex)) {
            String c = j.optString("retCode");
            return "10006".equals(c) || "10018".equals(c);
        }
        return j.optInt("code", 0) == -1003 || j.optInt("code", 0) == -1015;
    }

    /**
     * Deduped idempotency key: the live engine hands one to the exchange so a
     * retried submit cannot create a second order.
     */
    static String clientId(String prefix) {
        String base = prefix == null ? "cai" : prefix;
        String rand = Long.toString(System.currentTimeMillis() % 100000, 36);
        return (base + rand + Integer.toHexString((int) (Math.random() * 0xffff))).substring(0, Math.min(36, base.length() + rand.length() + 4));
    }

    private static String fail(String unused, String code, String msg) {
        JSONObject o = new JSONObject();
        try {
            o.put("ok", false);
            o.put("error", true);
            o.put("status", 0);
            o.put("code", code);
            o.put("msg", msg == null ? "" : msg);
            o.put("retryable", false);
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    private static String truncate(String s, int n) {
        return s.length() <= n ? s : s.substring(0, n);
    }

    /** Maps a UI params object to a stable query string (used by tests/diagnostics). */
    static String qs(JSONObject o) {
        StringBuilder sb = new StringBuilder();
        Map<String, String> sorted = new HashMap<>();
        Iterator<String> it = o.keys();
        while (it.hasNext()) {
            String k = it.next();
            sorted.put(k, String.valueOf(o.opt(k)));
        }
        java.util.TreeMap<String, String> t = new java.util.TreeMap<>(sorted);
        for (Map.Entry<String, String> e : t.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(e.getKey()).append('=').append(Http.enc(e.getValue()));
        }
        return sb.toString();
    }
}
