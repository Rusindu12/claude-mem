package com.cryptoai.pro;

import org.json.JSONObject;

import java.net.URLEncoder;
import java.util.Iterator;
import java.util.TreeMap;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Bybit v5 signing: HMAC-SHA256 over timestamp + apiKey + recvWindow + queryString,
 * sent with X-BAPI-* headers.
 */
final class Bybit {

    private static final String RECV = "10000";

    private Bybit() {}

    static String sign(Keys keys, String method, String path, String paramsJson) throws Exception {
        String apiKey = keys.key("bybit");
        String secret = keys.secret("bybit");
        if (apiKey == null || apiKey.isEmpty() || secret == null || secret.isEmpty()) {
            return "{\"error\":true,\"msg\":\"no Bybit API keys saved\"}";
        }

        TreeMap<String, String> params = new TreeMap<>();
        if (paramsJson != null && !paramsJson.trim().isEmpty()) {
            JSONObject o = new JSONObject(paramsJson);
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = o.optString(k, "");
                if (v != null && !v.isEmpty()) params.put(k, v);
            }
        }

        String ts = String.valueOf(System.currentTimeMillis());
        boolean isPost = "POST".equalsIgnoreCase(method);
        String payloadKey = isPost ? "json" : "query";
        String payloadSb = canonical(params);
        String qs = queryString(params);
        String toSign = ts + apiKey + RECV + (payloadSb == null ? "" : payloadSb);
        String sig = hmac(secret, toSign);

        String base = keys.base("bybit");
        String url;
        String body = null;
        if (isPost) {
            url = base + path;
            body = payloadSb == null ? "" : payloadSb;
        } else {
            url = base + path + (qs.isEmpty() ? "" : "?" + qs);
        }
        String headers = "{"
                + "\"X-BAPI-API-KEY\":\"" + apiKey + "\","
                + "\"X-BAPI-TIMESTAMP\":\"" + ts + "\","
                + "\"X-BAPI-RECV-WINDOW\":\"" + RECV + "\","
                + "\"X-BAPI-SIGN\":\"" + sig + "\","
                + "\"X-BAPI-SIGN-TYPE\":\"2\","
                + "\"Content-Type\":\"application/json\"}";
        return Http.send(method, url, body, headers);
    }

    /** Bybit signs JSON bodies in alphabetically ordered key form (no spaces). */
    private static String canonical(TreeMap<String, String> p) {
        if (p.isEmpty()) return "";
        StringBuilder sb = new StringBuilder("{");
        for (java.util.Map.Entry<String, String> e : p.entrySet()) {
            if (sb.length() > 1) sb.append(',');
            sb.append('"').append(e.getKey()).append("\":\"").append(e.getValue().replace("\"", "\\\"")).append('"');
        }
        return sb.append('}').toString();
    }

    private static String queryString(TreeMap<String, String> p) {
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
}
