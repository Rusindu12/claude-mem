package com.cryptoai.pro;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Host activity for the CryptoAI PRO single-file web app.
 *
 * The UI (index.html) is served from the app's assets over a synthetic
 * https://cryptoai.local origin instead of file:// so that localStorage,
 * secure-context APIs and WebSockets behave exactly like on a normal site.
 *
 * Native capabilities are exposed to the page as window.AndroidBridge (see Bridge).
 */
public class MainActivity extends Activity {

    static final String APP_HOST = "cryptoai.local";
    static final String APP_URL = "https://" + APP_HOST + "/index.html";

    private WebView web;
    private Bridge bridge;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0E17);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " CryptoAIPro/" + BuildConfig.VERSION_NAME);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            s.setSafeBrowsingEnabled(false);
        }

        bridge = new Bridge(this);
        web.addJavascriptInterface(bridge, "AndroidBridge");
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setWebViewClient(new AppClient());
        web.loadUrl(APP_URL);
        setContentView(web);

        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 10);
        }
    }

    /** Serves assets for the virtual host and keeps every other navigation inside the app. */
    private class AppClient extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
            String host = req.getUrl().getHost();
            if (host != null && (host.equals(APP_HOST) || host.equals("localhost"))) {
                String path = req.getUrl().getPath();
                if (path == null || path.equals("/") || path.isEmpty()) {
                    path = "/index.html";
                }
                String asset = path.startsWith("/") ? path.substring(1) : path;
                try {
                    InputStream in = getAssets().open(asset);
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Access-Control-Allow-Origin", "*");
                    headers.put("Cache-Control", "no-cache");
                    return new WebResourceResponse(mimeOf(asset), "utf-8", 200, "OK", headers, in);
                } catch (IOException e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                            new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
                }
            }
            return null;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            String host = req.getUrl().getHost();
            if (host != null && (host.equals(APP_HOST) || host.equals("localhost"))) {
                return false;
            }
            return true; // external links are ignored, the app never leaves the WebView
        }
    }

    private static String mimeOf(String asset) {
        if (asset.endsWith(".html") || asset.endsWith(".htm")) return "text/html";
        if (asset.endsWith(".js")) return "application/javascript";
        if (asset.endsWith(".css")) return "text/css";
        if (asset.endsWith(".json")) return "application/json";
        if (asset.endsWith(".svg")) return "image/svg+xml";
        if (asset.endsWith(".png")) return "image/png";
        if (asset.endsWith(".jpg") || asset.endsWith(".jpeg")) return "image/jpeg";
        if (asset.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (bridge != null) bridge.shutdown();
        if (web != null) {
            web.removeJavascriptInterface("AndroidBridge");
            web.destroy();
        }
        super.onDestroy();
    }
}
