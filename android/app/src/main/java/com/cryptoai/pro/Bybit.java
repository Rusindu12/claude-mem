package com.cryptoai.pro;

import org.json.JSONObject;

import java.util.Iterator;
import java.util.TreeMap;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Bybit v5 signing: HMAC-SHA256 over timestamp + apiKey + recvWindow + payload,
 * sent with X-BAPI-* headers. JSON bodies are signed in ordered, compact form.
 */
final class Bybit {

    private static final String RECV = "10000";
    static final String MAINNET = "https://api.bybit.com";
    static final String TESTNET = "https://api-testnet.bybit.com";

    private Bybit() {}

    static String base(boolean testnet) {
        return testnet ? TESTNET : MAINNET;
    }

    static Http.Req signedRequest(String apiKey, String secret, boolean testnet,
                                  String method, String path, JSONObject params) throws Exception {
        TreeMap<String, String> p = Binance.flatten(params);
        String ts = String.valueOf(System.currentTimeMillis());
        boolean body = "POST".equalsIgnoreCase(method);
        String payload = body ? compact(p) : query(p);
        String sig = hmac(secret, ts + apiKey + RECV + payload);

        String base = base(testnet);
        String url = body ? base + path : base + path + (payload.isEmpty() ? "" : "?" + payload);
        String headers = "{"
                + "\"X-BAPI-API-KEY\":\"" + apiKey + "\","
                + "\"X-BAPI-TIMESTAMP\":\"" + ts + "\","
                + "\"X-BAPI-RECV-WINDOW\":\"" + RECV + "\","
                + "\"X-BAPI-SIGN\":\"" + sig + "\","
                + "\"X-BAPI-SIGN-TYPE\":\"2\","
                + "\"Content-Type\":\"application/json\"}";
        return new Http.Req(body ? "POST" : "GET", url, body ? payload : null, headers);
    }

    static String sign(Keys keys, String method, String path, String paramsJson) {
        String apiKey = keys.key("bybit");
        String secret = keys.secret("bybit");
        if (apiKey == null || apiKey.isEmpty() || secret == null || secret.isEmpty()) {
            return "{\"error\":true,\"msg\":\"no Bybit API keys saved\"}";
        }
        try {
            JSONObject params = (paramsJson == null || paramsJson.trim().isEmpty()) ? new JSONObject() : new JSONObject(paramsJson);
            return Http.send(signedRequest(apiKey, secret, keys.testnet("bybit"), method, path, params)).body;
        } catch (Exception e) {
            return "{\"error\":true,\"msg\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
        }
    }

    /** Bybit signs JSON bodies in alphabetically ordered, space-free form. */
    private static String compact(TreeMap<String, String> p) {
        if (p.isEmpty()) return "";
        StringBuilder sb = new StringBuilder("{");
        for (java.util.Map.Entry<String, String> e : p.entrySet()) {
            if (sb.length() > 1) sb.append(',');
            sb.append('"').append(e.getKey()).append("\":\"").append(e.getValue().replace("\"", "\\\"")).append('"');
        }
        return sb.append('}').toString();
    }

    private static String query(TreeMap<String, String> p) {
        StringBuilder sb = new StringBuilder();
        for (java.util.Map.Entry<String, String> e : p.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(e.getKey()).append('=').append(e.getValue());
        }
        return sb.toString();
    }

    static String hmac(String secret, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes("UTF-8"), "HmacSHA256"));
        byte[] out = mac.doFinal(data.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder(out.length * 2);
        for (byte b : out) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Convenience for tests/tools: ordered string of the given params. */
    static String canonical(JSONObject o) {
        TreeMap<String, String> p = Binance.flatten(o);
        Iterator<String> it = p.keySet().iterator();
        return it.hasNext() ? compact(p) : "";
    }
}
