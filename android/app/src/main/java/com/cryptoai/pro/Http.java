package com.cryptoai.pro;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;

import org.json.JSONObject;

/** Small blocking HTTP helper used by the JavaScript bridge (runs on the JS bridge thread). */
final class Http {

    private Http() {}

    /** A prepared request: everything already signed. */
    static final class Req {
        final String method;
        final String url;
        final String body;
        final String headersJson;

        Req(String method, String url, String body, String headersJson) {
            this.method = method;
            this.url = url;
            this.body = body;
            this.headersJson = headersJson;
        }
    }

    /** Response with status + headers, needed by the live-trading layer. */
    static final class Resp {
        final int status;
        final String body;
        final Map<String, String> headers;

        Resp(int status, String body, Map<String, String> headers) {
            this.status = status;
            this.body = body;
            this.headers = headers;
        }

        boolean ok() {
            return status >= 200 && status < 300;
        }

        JSONObject json() {
            try {
                return new JSONObject(body);
            } catch (Exception e) {
                return null;
            }
        }

        /** Pretty-ish envelope for the web layer: {status, body, headers} */
        String envelope() {
            try {
                JSONObject o = new JSONObject();
                o.put("status", status);
                o.put("body", body);
                o.put("ok", ok());
                JSONObject h = new JSONObject();
                for (Map.Entry<String, String> e : headers.entrySet()) {
                    if (e.getKey() != null && e.getValue() != null) h.put(e.getKey(), e.getValue());
                }
                o.put("headers", h);
                return o.toString();
            } catch (Exception e) {
                return "{\"status\":" + status + ",\"body\":\"\"}";
            }
        }
    }

    static String get(String url, String headersJson) throws Exception {
        return send(new Req("GET", url, null, headersJson)).body;
    }

    static String post(String url, String body, String headersJson) throws Exception {
        return send(new Req("POST", url, body, headersJson)).body;
    }

    static String send(String method, String url, String body, String headersJson) throws Exception {
        return send(new Req(method, url, body, headersJson)).body;
    }

    static Resp send(Req req) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(req.url).openConnection();
            c.setRequestMethod(req.method == null ? "GET" : req.method);
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            c.setInstanceFollowRedirects(true);
            c.setRequestProperty("User-Agent", "CryptoAIPro/" + BuildConfig.VERSION_NAME + " (Android)");
            c.setRequestProperty("Accept", "application/json, text/plain, */*");

            if (req.headersJson != null && !req.headersJson.isEmpty()) {
                JSONObject h = new JSONObject(req.headersJson);
                Iterator<String> it = h.keys();
                while (it.hasNext()) {
                    String k = it.next();
                    c.setRequestProperty(k, String.valueOf(h.opt(k)));
                }
            }

            if (req.body != null) {
                c.setDoOutput(true);
                byte[] out = req.body.getBytes("UTF-8");
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
            if (text == null) text = "";
            if (text.isEmpty()) text = "{\"error\":true,\"msg\":\"empty response (HTTP " + code + ")\"}";

            Map<String, String> headers = new LinkedHashMap<>();
            for (Map.Entry<String, java.util.List<String>> e : c.getHeaderFields().entrySet()) {
                if (e.getKey() == null || e.getValue() == null || e.getValue().isEmpty()) continue;
                headers.put(e.getKey(), e.getValue().get(0));
            }
            return new Resp(code, text, headers);
        } catch (Exception e) {
            String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            String body = "{\"error\":true,\"msg\":" + JSONObject.quote(msg) + "}";
            return new Resp(0, body, new LinkedHashMap<String, String>());
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

    static String enc(String v) {
        try {
            return java.net.URLEncoder.encode(v == null ? "" : v, "UTF-8");
        } catch (Exception e) {
            return "";
        }
    }
}
