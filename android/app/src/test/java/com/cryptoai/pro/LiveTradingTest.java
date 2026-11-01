package com.cryptoai.pro;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.HashMap;

/**
 * Offline checks for the signing + envelope logic (no Android device needed).
 *
 * Run:  android/scripts/build.sh --tests
 *   or: javac/ecj the sources + this file, then `java com.cryptoai.pro.LiveTradingTest`
 */
public final class LiveTradingTest {

    private static int failures = 0;
    private static int checks = 0;

    public static void main(String[] args) throws Exception {
        bybitCanonicalAndSignature();
        binanceSignature();
        bybitEnvelopeMapping();
        binanceEnvelopeMapping();
        networkFailureEnvelope();
        clientIdShape();

        System.out.println();
        if (failures == 0) {
            System.out.println("all " + checks + " android live-trading checks passed");
            System.exit(0);
        }
        System.out.println("FAILED: " + failures + " of " + checks);
        System.exit(1);
    }

    /* ------------------------------------------------------------- cases */

    private static void bybitCanonicalAndSignature() throws Exception {
        JSONObject p = new JSONObject();
        p.put("qty", "0.01");
        p.put("symbol", "BTCUSDT");
        p.put("side", "Buy");

        String canonical = Bybit.canonical(p);
        eq("{\"qty\":\"0.01\",\"side\":\"Buy\",\"symbol\":\"BTCUSDT\"}", canonical, "bybit canonical body is ordered + compact");

        // HMAC-SHA256("secret", "1000" + "key" + "10000" + canonical)
        String expected = hmac("secret", "1000" + "key" + "10000" + canonical);
        eq(expected, Bybit.hmac("secret", "1000" + "key" + "10000" + canonical), "bybit signature is deterministic HMAC-SHA256");
        eq(64, expected.length(), "bybit signature is 64 hex chars");

        Http.Req req = Bybit.signedRequest("key", "secret", false, "POST", "/v5/order/create", p);
        ok(req.url.equals("https://api.bybit.com/v5/order/create"), "bybit mainnet host", req.url);
        ok(req.body.equals(canonical), "bybit POST body is the signed payload", req.body);
        ok(req.headersJson.contains("X-BAPI-SIGN"), "bybit sends X-BAPI-SIGN");
        ok(req.headersJson.contains("X-BAPI-RECV-WINDOW"), "bybit sends recv window");

        Http.Req test = Bybit.signedRequest("key", "secret", true, "GET", "/v5/account/wallet-balance", new JSONObject().put("accountType", "UNIFIED"));
        ok(test.url.startsWith("https://api-testnet.bybit.com/v5/account/wallet-balance?"), "bybit testnet host", test.url);
        ok(test.url.contains("accountType=UNIFIED"), "bybit query params signed into the url");
    }

    private static void binanceSignature() throws Exception {
        JSONObject p = new JSONObject();
        p.put("symbol", "BTCUSDT");
        p.put("side", "BUY");
        p.put("type", "MARKET");
        p.put("quantity", "0.001");
        p.put("newClientOrderId", "cai123");

        Http.Req req = Binance.signedRequest("k", "s", false, "POST", "/api/v3/order", p);
        ok(req.url.equals("https://api.binance.com/api/v3/order"), "binance mainnet url", req.url);
        ok(req.body.contains("signature="), "binance POST carries a signature");
        ok(req.body.contains("timestamp="), "binance adds timestamp");
        ok(req.body.contains("recvWindow=10000"), "binance adds recvWindow");
        ok(req.body.contains("newClientOrderId=cai123"), "client order id forwarded");
        ok(req.headersJson.contains("X-MBX-APIKEY"), "binance sends X-MBX-APIKEY");

        Http.Req t = Binance.signedRequest("k", "s", true, "GET", "/api/v3/account", new JSONObject());
        ok(t.url.startsWith("https://testnet.binance.vision/api/v3/account?"), "binance testnet host", t.url);
        ok(t.body == null, "GET has no body");

        Http.Req del = Binance.signedRequest("k", "s", false, "DELETE", "/api/v3/order", p);
        ok("DELETE".equals(del.method), "DELETE method preserved");
        ok(del.url.contains("signature="), "DELETE params signed in the query");
    }

    private static void bybitEnvelopeMapping() throws Exception {
        String okBody = "{\"retCode\":0,\"retMsg\":\"OK\",\"result\":{\"orderId\":\"abc-1\",\"orderLinkId\":\"cai1\",\"cumExecQty\":\"0.01\",\"avgPrice\":\"50000\"}}";
        JSONObject r = new JSONObject(LiveTrading.normalise("bybit", resp(200, okBody, new HashMap<String, String>())));
        ok(r.optBoolean("ok"), "bybit success envelope");
        eq("abc-1", r.optString("orderId"), "bybit orderId mapped");
        eq("cai1", r.optString("clientId"), "bybit clientId mapped");
        eq("0.01", r.optString("execQty"), "bybit execQty mapped");
        ok(r.optString("raw").contains("retCode"), "raw reply preserved");

        String bad = "{\"retCode\":170131,\"retMsg\":\"Insufficient balance\"}";
        JSONObject e = new JSONObject(LiveTrading.normalise("bybit", resp(200, bad, new HashMap<String, String>())));
        ok(!e.optBoolean("ok") && e.optBoolean("error"), "bybit retCode != 0 is an error");
        eq("170131", e.optString("code"), "bybit retCode exposed as code");
        eq("Insufficient balance", e.optString("msg"), "bybit retMsg exposed as msg");

        JSONObject rl = new JSONObject(LiveTrading.normalise("bybit", resp(200, "{\"retCode\":10006,\"retMsg\":\"too many visits\"}", new HashMap<String, String>())));
        ok(rl.optBoolean("rateLimited"), "bybit retCode 10006 flagged as rate limited");

        String perms = "{\"retCode\":0,\"result\":{\"list\":[{\"coin\":[],\"permissions\":[\"Spot\"]}]}}";
        ok(new JSONObject(LiveTrading.normalise("bybit", resp(200, perms, new HashMap<String, String>()))).optBoolean("ok"), "bybit balance reply parses");
    }

    private static void binanceEnvelopeMapping() throws Exception {
        String fill = "{\"symbol\":\"BTCUSDT\",\"orderId\":42,\"clientOrderId\":\"cai9\",\"executedQty\":\"0.002\","
                + "\"cummulativeQuoteQty\":\"100\",\"status\":\"FILLED\",\"avgPrice\":\"0\","
                + "\"fills\":[{\"price\":\"50000\",\"qty\":\"0.002\",\"commission\":\"0.1\",\"commissionAsset\":\"USDT\",\"tradeId\":\"9\"}]}";
        JSONObject r = new JSONObject(LiveTrading.normalise("binance", resp(200, fill, new HashMap<String, String>())));
        ok(r.optBoolean("ok"), "binance fill envelope ok");
        eq("42", r.optString("orderId"), "binance orderId mapped");
        eq("0.002", r.optString("execQty"), "binance executedQty mapped");
        eq("FILLED", r.optString("orderStatus"), "binance status mapped");
        ok(r.optJSONArray("fills").length() == 1, "binance fills forwarded");
        eq("0.1", r.optJSONArray("fills").optJSONObject(0).optString("commission"), "binance commission forwarded");

        JSONObject e = new JSONObject(LiveTrading.normalise("binance", resp(400, "{\"code\":-2010,\"msg\":\"Account has insufficient balance\"}", new HashMap<String, String>())));
        ok(!e.optBoolean("ok"), "binance negative code is an error");
        eq("-2010", e.optString("code"), "binance code exposed");

        JSONObject skew = new JSONObject(LiveTrading.normalise("binance", resp(400, "{\"code\":-1021,\"msg\":\"Timestamp for this request is outside of the recvWindow.\"}", new HashMap<String, String>())));
        ok(!skew.optBoolean("ok"), "clock skew is an error");

        JSONObject rl = new JSONObject(LiveTrading.normalise("binance", resp(429, "{\"code\":-1003,\"msg\":\"Too many requests\"}", new HashMap<String, String>())));
        ok(rl.optBoolean("rateLimited") && rl.optBoolean("retryable"), "binance 429 flagged rate limited + retryable");

        JSONObject acct = new JSONObject(LiveTrading.normalise("binance", resp(200, "{\"permissions\":[\"SPOT\"],\"balances\":[]}", new HashMap<String, String>())));
        ok(acct.optBoolean("ok") && acct.optBoolean("account"), "binance account reply flagged");
    }

    private static void networkFailureEnvelope() throws Exception {
        JSONObject r = new JSONObject(LiveTrading.normalise("binance", resp(0, "{\"error\":true,\"msg\":\"timeout\"}", new HashMap<String, String>())));
        ok(!r.optBoolean("ok"), "network failure is an error");
        ok(r.optBoolean("retryable"), "network failure is retryable");

        JSONObject html = new JSONObject(LiveTrading.normalise("binance", resp(502, "<html>bad gateway</html>", new HashMap<String, String>())));
        ok(!html.optBoolean("ok"), "non-JSON body is an error");
        eq("bad_json", html.optString("code"), "non-JSON body flagged as bad_json");
        ok(html.optString("raw").contains("bad gateway"), "raw body kept for diagnostics");
    }

    private static void clientIdShape() {
        String id = LiveTrading.clientId("cai");
        ok(id.length() <= 36, "client order id is <= 36 chars (Binance limit)", id);
        ok(id.startsWith("cai"), "client order id keeps the prefix", id);
        ok(!LiveTrading.clientId("cai").equals(LiveTrading.clientId("cai")), "client order ids are unique");
    }

    /* ------------------------------------------------------------ helpers */

    private static Http.Resp resp(int status, String body, HashMap<String, String> headers) {
        return new Http.Resp(status, body, headers);
    }

    private static String hmac(String key, String data) throws Exception {
        javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
        mac.init(new javax.crypto.spec.SecretKeySpec(key.getBytes("UTF-8"), "HmacSHA256"));
        byte[] out = mac.doFinal(data.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder();
        for (byte b : out) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    private static void ok(boolean cond, String name) {
        ok(cond, name, null);
    }

    private static void ok(boolean cond, String name, String detail) {
        checks++;
        if (cond) System.out.println("  \u2713 " + name);
        else {
            failures++;
            System.out.println("  \u2717 " + name + (detail != null ? "  \u2192 " + detail : ""));
        }
    }

    private static void eq(String expected, String actual, String name) {
        ok(expected == null ? actual == null : expected.equals(actual), name, "expected " + expected + ", got " + actual);
    }

    private static void eq(int expected, int actual, String name) {
        ok(expected == actual, name, "expected " + expected + ", got " + actual);
    }

    private LiveTradingTest() {
    }
}
