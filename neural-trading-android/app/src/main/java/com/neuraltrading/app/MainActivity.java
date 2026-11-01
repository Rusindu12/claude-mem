package com.neuraltrading.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.graphics.Color;

/** Hosts the bundled paper-trading interface. No exchange-key bridge is exposed. */
public class MainActivity extends Activity {
    private WebView webView;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(10, 14, 23));
        getWindow().setNavigationBarColor(Color.rgb(10, 14, 23));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(10, 14, 23));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // The bundled app fetches public HTTPS market data from file origin.
        settings.setAllowFileAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // Keep arbitrary pages out of this privileged WebView.
            }
        });
        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    @Override public void onBackPressed() {
        // Close open sheets first; otherwise leave the app.
        if (webView != null) {
            webView.evaluateJavascript("(function(){var m=document.querySelector('.modal.on');if(m){m.classList.remove('on');return true}return false})()", value -> {
                if (!"true".equals(value)) MainActivity.super.onBackPressed();
            });
        } else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
