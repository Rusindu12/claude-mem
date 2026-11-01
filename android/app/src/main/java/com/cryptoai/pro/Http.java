package com.cryptoai.pro;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.Map;

import org.json.JSONObject;

/** Small blocking HTTP helper used by the JavaScript bridge (runs on the JS bridge thread). */
final class Http {

    private Http() {}

    static String get(String url, String headersJson) throws Exception {
        return send("GET", url, null, headersJson);
    }

    static String post(String url, String body, String headersJson) throws Exception {
        return send("POST", url, body, headersJson);
    }

    static String send(String method, String url, String body, String headersJson) throws Exception {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setRequestMethod(method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "CryptoAIPro/1.0 (Android)");
            c.setRequestProperty("Accept", "application/json, text/plain, */*");

            if (headersJson != null && !headersJson.isEmpty()) {
                JSONObject h = new JSONObject(headersJson);
                Iterator<String> it = h.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    c.setRequestProperty(k, String.valueOf(h.opt(k)));
                }
            }

            if (body != null) {
                c.setDoOutput(true);
                byte[] out = body.getBytes("UTF-8");
                c.setFixedLengthStreamingMode(out.length);
                OutputStream os = c.getOutputStream();
                try {
                    os.write(out);
                } finally {
                    os.close();
                }
            }

            int code = c.getResponseCode();
            InputStream in = (code >= 200 && code < 400) ? c.getInputStream() : c.getErrorStream();
            String text = readAll(in);
            if (text == null || text.isEmpty()) {
                text = "{\"error\":true,\"msg\":\"empty response (HTTP " + code + ")\"}";
            }
            return text;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        try {
            while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
        } finally {
            in.close();
        }
        return bos.toString("UTF-8");
    }

    static String query(Map<String, String> params) {
        StringBuilder sb = new StringBuilder();
        for (Map.Entry<String, String> e : params.entrySet()) {
            if (sb.length() > 0) sb.append('&');
            sb.append(enc(e.getKey())).append('=').append(enc(e.getValue()));
        }
        return sb.toString();
    }

    static String enc(String v) {
        try {
            return java.net.URLEncoder.encode(v == null ? "" : v, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
