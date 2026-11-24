package lk.cryptoai.pro;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import android.Manifest;
import android.content.pm.PackageManager;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeMap;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import android.util.Base64;

public final class MainActivity extends Activity {
    private WebView web;
    private static final String PREF = "cryptoai_secure";
    private static final String KEY_ALIAS = "CryptoAIProKeysV1";

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(android.graphics.Color.rgb(8, 12, 21));
        getWindow().setNavigationBarColor(android.graphics.Color.rgb(8, 12, 21));
        web = new WebView(this);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(false);
        ws.setAllowFileAccess(true);
        ws.setAllowContentAccess(false);
        ws.setAllowFileAccessFromFileURLs(false);
        ws.setAllowUniversalAccessFromFileURLs(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        ws.setMediaPlaybackRequiresUserGesture(true);
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request == null || !"file:///android_asset/www/index.html".equals(request.getUrl().toString());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !"file:///android_asset/www/index.html".equals(url);
            }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");
        createNotificationChannel();
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 410);
        }
    }

    @Override public void onBackPressed() {
        if (web != null) web.evaluateJavascript("(function(){var m=document.querySelector('.modal.on');if(m){m.classList.remove('on');return 'modal'}return 'none'})()", new android.webkit.ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
                if ("\"none\"".equals(value)) MainActivity.this.finish();
            }
        });
        else super.onBackPressed();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel c = new NotificationChannel("cryptoai_alerts", "CryptoAI alerts", NotificationManager.IMPORTANCE_DEFAULT);
            c.setDescription("Price alerts and paper-bot notifications");
            ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(c);
        }
    }

    private static String readAll(InputStream in) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8));
        StringBuilder b = new StringBuilder(); String line;
        while ((line = r.readLine()) != null) b.append(line);
        r.close(); return b.toString();
    }
    private static String q(String s) throws Exception { return URLEncoder.encode(s, "UTF-8"); }
    private static String errorJson(String message) {
        try { JSONObject x = new JSONObject(); x.put("code", -1); x.put("msg", message == null ? "Request failed" : message); return x.toString(); }
        catch (Exception e) { return "{\"code\":-1,\"msg\":\"Request failed\"}"; }
    }
    private static boolean validHost(String url) {
        try {
            URI u = URI.create(url);
            String h = u.getHost();
            return "https".equalsIgnoreCase(u.getScheme()) && h != null &&
              (h.equalsIgnoreCase("api.binance.com") || h.equalsIgnoreCase("api.bybit.com") || h.equalsIgnoreCase("www.okx.com"));
        } catch (Exception e) { return false; }
    }
    private static String request(String url, String method, String body, String apiKey) throws Exception {
        if (!validHost(url)) throw new Exception("Blocked exchange host");
        HttpURLConnection c = (HttpURLConnection)new URL(url).openConnection();
        c.setRequestMethod(method); c.setConnectTimeout(12000); c.setReadTimeout(16000);
        c.setRequestProperty("User-Agent", "CryptoAI-PRO-Android/3.0");
        c.setRequestProperty("Accept", "application/json");
        if (apiKey != null) c.setRequestProperty("X-MBX-APIKEY", apiKey);
        if (body != null) {
            c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=utf-8");
            OutputStream o = c.getOutputStream(); o.write(body.getBytes(StandardCharsets.UTF_8)); o.close();
        }
        int code = c.getResponseCode();
        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
        String out = in == null ? "{}" : readAll(in);
        c.disconnect(); return out;
    }

    private SecretKey getEncryptionKey() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (ks.containsAlias(KEY_ALIAS)) return (SecretKey)ks.getKey(KEY_ALIAS, null);
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return gen.generateKey();
    }
    private void saveKeys(String key, String secret) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE, getEncryptionKey());
        byte[] cipher = c.doFinal((key + "\n" + secret).getBytes(StandardCharsets.UTF_8));
        String iv = Base64.encodeToString(c.getIV(), Base64.NO_WRAP);
        String data = Base64.encodeToString(cipher, Base64.NO_WRAP);
        getSharedPreferences(PREF, MODE_PRIVATE).edit().putString("iv", iv).putString("data", data).apply();
    }
    private String[] loadKeys() throws Exception {
        String iv = getSharedPreferences(PREF, MODE_PRIVATE).getString("iv", null);
        String data = getSharedPreferences(PREF, MODE_PRIVATE).getString("data", null);
        if (iv == null || data == null) return new String[]{"", ""};
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, getEncryptionKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        String plain = new String(c.doFinal(Base64.decode(data, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        int i = plain.indexOf('\n'); return i < 0 ? new String[]{"", ""} : new String[]{plain.substring(0, i), plain.substring(i + 1)};
    }

    public final class AndroidBridge {
        @JavascriptInterface public String httpGet(String url) {
            try { return request(url, "GET", null, null); }
            catch (Exception e) { return errorJson(e.getMessage()); }
        }
        @JavascriptInterface public String httpPost(String url, String json) {
            return errorJson("Unauthenticated POST requests are disabled");
        }
        @JavascriptInterface public String getKeys() {
            try { String[] k = loadKeys(); JSONObject o = new JSONObject(); o.put("key", k[0]); o.put("secret", k[1]); return o.toString(); }
            catch (Exception e) { return "{\"key\":\"\",\"secret\":\"\"}"; }
        }
        @JavascriptInterface public void setKeys(String key, String secret) {
            try { saveKeys(key == null ? "" : key.trim(), secret == null ? "" : secret.trim()); }
            catch (Exception e) { runOnUiThread(new Runnable() { @Override public void run() { Toast.makeText(MainActivity.this, "Could not secure keys", Toast.LENGTH_SHORT).show(); } }); }
        }
        @JavascriptInterface public void clearKeys() {
            getSharedPreferences(PREF, MODE_PRIVATE).edit().clear().apply();
            try { KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null); if (ks.containsAlias(KEY_ALIAS)) ks.deleteEntry(KEY_ALIAS); } catch (Exception ignored) {}
        }
        @JavascriptInterface public String signed(String method, String path, String paramsJson) {
            try {
                if (path == null || !(path.equals("/api/v3/account") || path.equals("/api/v3/order") || path.equals("/api/v3/openOrders") || path.equals("/api/v3/orderList/oco") || path.equals("/api/v3/orderList"))) throw new Exception("Only account, open-order, OCO and spot-order endpoints are allowed");
                String[] keys = loadKeys(); if (keys[0].isEmpty() || keys[1].isEmpty()) throw new Exception("Save Binance API keys first");
                JSONObject input = new JSONObject(paramsJson == null ? "{}" : paramsJson);
                Map<String,String> params = new TreeMap<>();
                Iterator<String> it = input.keys(); while (it.hasNext()) { String k = it.next(); params.put(k, String.valueOf(input.get(k))); }
                if (!params.containsKey("timestamp")) params.put("timestamp", String.valueOf(System.currentTimeMillis()));
                if (!params.containsKey("recvWindow")) params.put("recvWindow", "5000");
                StringBuilder q = new StringBuilder();
                for (Map.Entry<String,String> e : params.entrySet()) { if (q.length()>0) q.append('&'); q.append(q(e.getKey())).append('=').append(q(e.getValue())); }
                Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(keys[1].getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
                byte[] sig = mac.doFinal(q.toString().getBytes(StandardCharsets.UTF_8));
                StringBuilder hex = new StringBuilder(); for (byte b : sig) hex.append(String.format(Locale.US, "%02x", b & 0xff));
                String url = "https://api.binance.com" + path + "?" + q + "&signature=" + hex;
                String m = method == null ? "GET" : method.toUpperCase(Locale.US);
                if ((path.equals("/api/v3/account") || path.equals("/api/v3/openOrders")) && !m.equals("GET")) throw new Exception("Read-only account endpoint");
                if (path.equals("/api/v3/orderList/oco") && !m.equals("POST")) throw new Exception("OCO endpoint only accepts POST");
                if (path.equals("/api/v3/orderList") && !m.equals("DELETE")) throw new Exception("OCO cancel endpoint only accepts DELETE");
                if (path.equals("/api/v3/order") && !m.equals("POST") && !m.equals("DELETE")) throw new Exception("Unsupported spot order method");
                String body = m.equals("GET") ? null : url.substring(url.indexOf('?') + 1);
                String target = m.equals("GET") ? url : "https://api.binance.com" + path;
                return request(target, m, body, keys[0]);
            } catch (Exception e) { return errorJson(e.getMessage()); }
        }
        @JavascriptInterface public void notify(String title, String message) {
            try {
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
                Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(MainActivity.this, "cryptoai_alerts") : new Notification.Builder(MainActivity.this);
                b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title == null ? "CryptoAI PRO" : title).setContentText(message == null ? "Alert" : message).setAutoCancel(true);
                ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify((int)(System.currentTimeMillis() & 0x7fffffff), b.build());
            } catch (Exception ignored) {}
        }
        @JavascriptInterface public void haptic() {
            try { Vibrator v = (Vibrator)getSystemService(VIBRATOR_SERVICE); if (v != null && v.hasVibrator()) { if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createOneShot(25, VibrationEffect.DEFAULT_AMPLITUDE)); else v.vibrate(25); } } catch (Exception ignored) {}
        }
        @JavascriptInterface public void keepScreenOn(boolean on) {
            runOnUiThread(new Runnable() { @Override public void run() { if (web != null) web.setKeepScreenOn(on); } });
        }
    }
}
