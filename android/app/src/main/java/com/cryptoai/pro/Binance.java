package com.cryptoai.pro;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.Iterator;
import java.util.TreeMap;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Binance spot signing: HMAC-SHA256 over the query string, sent as X-MBX-APIKEY.
 * Orders are placed with the signed REST API only; withdrawal endpoints are
 * never called by the app.
 */
final class Binance {

    private Binance() {}

    static final String MAINNET = "https://api.binance.com";
    static final String TESTNET = "https://testnet.binance.vision";

    static String base(boolean testnet) {
        return testnet ? TESTNET : MAINNET;
    }

    /** Builds a signed request (timestamp + recvWindow + HMAC-SHA256 signature). */
    static Http.Req signedRequest(String apiKey, String secret, boolean testnet,
                                  String method, String path, JSONObject params) throws Exception {
        TreeMap<String, String> p = flatten(params);
        p.put("timestamp", String.valueOf(System.currentTimeMillis()));
        p.put("recvWindow", "10000");

        StringBuilder qs = new StringBuilder();
        for (java.util.Map.Entry<String, String> e : p.entrySet()) {
            if (qs.length() > 0) qs.append('&');
            qs.append(e.getKey()).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8"));
        }
        String q = qs + "&signature=" + hmac(secret, qs.toString());

        String base = base(testnet);
        String headers = "{\"X-MBX-APIKEY\":\"" + apiKey + "\",\"Content-Type\":\"application/x-www-form-urlencoded\"}";
        if ("POST".equalsIgnoreCase(method) || "PUT".equalsIgnoreCase(method) || "DELETE".equalsIgnoreCase(method)) {
            // Binance accepts signed parameters in the body for POST; DELETE/PUT take them in the query.
            if ("POST".equalsIgnoreCase(method)) {
                return new Http.Req("POST", base + path, q, headers);
            }
            return new Http.Req(method.toUpperCase(), base + path + (path.contains("?") ? "&" : "?") + q, null, headers);
        }
        return new Http.Req("GET", base + path + (path.contains("?") ? "&" : "?") + q,
                null, "{\"X-MBX-APIKEY\":\"" + apiKey + "\"}");
    }

    static String sign(Keys keys, String method, String path, String paramsJson) {
        String apiKey = keys.key("binance");
        String secret = keys.secret("binance");
        if (apiKey == null || apiKey.isEmpty() || secret == null || secret.isEmpty()) {
            return "{\"error\":true,\"msg\":\"no Binance API keys saved\"}";
        }
        try {
            JSONObject params = (paramsJson == null || paramsJson.trim().isEmpty()) ? new JSONObject() : new JSONObject(paramsJson);
            return Http.send(signedRequest(apiKey, secret, keys.testnet("binance"), method, path, params)).body;
        } catch (Exception e) {
            return "{\"error\":true,\"msg\":" + JSONObject.quote(String.valueOf(e.getMessage())) + "}";
        }
    }

    static String hmac(String secret, String data) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes("UTF-8"), "HmacSHA256"));
        byte[] out = mac.doFinal(data.getBytes("UTF-8"));
        StringBuilder sb = new StringBuilder(out.length * 2);
        for (byte b : out) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    static TreeMap<String, String> flatten(JSONObject o) {
        TreeMap<String, String> p = new TreeMap<>();
        if (o == null) return p;
        Iterator<String> it = o.keys();
        while (it.hasNext()) {
            String k = it.next();
            Object v = o.opt(k);
            if (v == null || v == JSONObject.NULL) continue;
            String s = String.valueOf(v);
            if (!s.isEmpty()) p.put(k, s);
        }
        return p;
    }
}
