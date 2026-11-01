package com.neuraltrading.app;

import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.Iterator;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Testnet-only Spot bridge. Credentials exist only for the lifetime of the Activity. */
public final class BinanceTestnetBridge {
    private static final String HOST = "https://testnet.binance.vision";
    private String apiKey = "";
    private String apiSecret = "";

    @JavascriptInterface public String version() { return "1.1-testnet"; }

    @JavascriptInterface public synchronized String binanceSaveKeys(String key, String secret, boolean testnet) {
        if (!testnet || key == null || secret == null || key.trim().isEmpty() || secret.trim().isEmpty()) return null;
        apiKey = key.trim(); apiSecret = secret.trim();
        return "ok";
    }
    @JavascriptInterface public synchronized String binanceClearKeys() { apiKey = ""; apiSecret = ""; return "ok"; }
    @JavascriptInterface public synchronized String binanceStatus() {
        try { return new JSONObject().put("hasKeys", !apiKey.isEmpty()).put("base", "Binance Spot TESTNET (session only)").toString(); }
        catch (Exception e) { return "{}"; }
    }
    @JavascriptInterface public synchronized String binanceSigned(String method, String path, String input) {
        try {
            if (apiKey.isEmpty() || apiSecret.isEmpty()) return error("Add Testnet keys first");
            boolean allowed = (method.equals("GET") && (path.equals("/api/v3/account") || path.equals("/api/v3/openOrders"))) ||
                    (method.equals("POST") && path.equals("/api/v3/order")) ||
                    (method.equals("DELETE") && path.equals("/api/v3/order"));
            if (!allowed) return error("Endpoint not allowed");
            JSONObject params = new JSONObject(input);
            StringBuilder query = new StringBuilder();
            Iterator<String> keys = params.keys();
            while (keys.hasNext()) {
                String k = keys.next();
                if (!k.matches("[A-Za-z][A-Za-z0-9]*") || k.equals("timestamp") || k.equals("signature") || k.equals("recvWindow")) return error("Invalid parameter");
                Object v = params.get(k);
                if (!(v instanceof String) && !(v instanceof Number) && !(v instanceof Boolean)) return error("Invalid parameter value");
                if (query.length() > 0) query.append('&');
                query.append(URLEncoder.encode(k, "UTF-8")).append('=').append(URLEncoder.encode(v.toString(), "UTF-8"));
            }
            if (query.length() > 0) query.append('&');
            query.append("recvWindow=5000&timestamp=").append(System.currentTimeMillis());
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(apiSecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] digest = mac.doFinal(query.toString().getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
            URL url = new URL(HOST + path + "?" + query + "&signature=" + hex);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(10000); conn.setReadTimeout(10000);
            conn.setRequestMethod(method); conn.setRequestProperty("X-MBX-APIKEY", apiKey);
            int code = conn.getResponseCode();
            InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
            if (stream == null) return error("Exchange request failed; order outcome may be unknown. Check exchange before retrying.");
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] buf = new byte[4096]; int n;
            while ((n = stream.read(buf)) != -1) { if (out.size() + n > 1048576) return error("Response too large"); out.write(buf, 0, n); }
            stream.close(); conn.disconnect();
            String result = new String(out.toByteArray(), StandardCharsets.UTF_8);
            if (code < 200 || code >= 300) return error("Binance Testnet request failed (HTTP " + code + "). Check order status before retrying.");
            return result;
        } catch (Exception e) { return error("Request failed; order outcome may be unknown. Check exchange before retrying."); }
    }
    private static String error(String message) {
        try { return new JSONObject().put("error", true).put("msg", message).toString(); }
        catch (Exception ignored) { return "{\"error\":true}"; }
    }
}
