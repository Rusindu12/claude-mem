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

    static String sign(Keys keys, String method, String path, String paramsJson) throws Exception {
        String apiKey = keys.key("binance");
        String secret = keys.secret("binance");
        if (apiKey == null || apiKey.isEmpty() || secret == null || secret.isEmpty()) {
            return "{\"error\":true,\"msg\":\"no Binance API keys saved\"}";
        }

        TreeMap<String, String> p = new TreeMap<>();
        if (paramsJson != null && !paramsJson.trim().isEmpty()) {
            JSONObject o = new JSONObject(paramsJson);
            Iterator<String> it = o.keys();
            while (it.hasNext()) {
                String k = it.next();
                String v = o.optString(k, "");
                if (v != null && !v.isEmpty()) p.put(k, v);
            }
        }
        p.put("timestamp", String.valueOf(System.currentTimeMillis()));
        p.put("recvWindow", "10000");

        StringBuilder qs = new StringBuilder();
        for (java.util.Map.Entry<String, String> e : p.entrySet()) {
            if (qs.length() > 0) qs.append('&');
            qs.append(e.getKey()).append('=').append(URLEncoder.encode(e.getValue(), "UTF-8"));
        }
        String sig = hmac(secret, qs.toString());

        String base = keys.base("binance");
        String url;
        String body = null;
        String headers;
        String q = qs + "&signature=" + sig;

        if ("POST".equalsIgnoreCase(method)) {
            url = base + path;
            body = q;
            headers = "{\"X-MBX-APIKEY\":\"" + apiKey + "\",\"Content-Type\":\"application/x-www-form-urlencoded\"}";
        } else {
            url = base + path + (path.contains("?") ? "&" : "?") + q;
            headers = "{\"X-MBX-APIKEY\":\"" + apiKey + "\"}";
        }
        return Http.send(method, url, body, headers);
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
