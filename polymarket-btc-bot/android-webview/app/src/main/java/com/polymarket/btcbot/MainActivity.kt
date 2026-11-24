package com.polymarket.btcbot

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private val prefsName = "polymarket_bot_prefs"
    private val keyUrl = "dashboard_url"

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this)
        webView = WebView(this)
        root.addView(
            webView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        )

        // Small floating button to configure Dashboard Server URL directly on the phone
        val urlBtn = Button(this).apply {
            text = "URL"
            alpha = 0.78f
            textSize = 11f
            setOnClickListener { showUrlDialog() }
        }
        val btnParams = FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.END
            setMargins(0, 0, 24, 32)
        }
        root.addView(urlBtn, btnParams)
        setContentView(root)

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    val currentUrl = getSavedUrl()
                    val html = """
                        <html><body style="font-family:sans-serif;padding:32px;background:#0f172a;color:#f8fafc;">
                        <h2>Cannot connect to Bot Dashboard</h2>
                        <p style="color:#94a3b8;">URL: <code>$currentUrl</code></p>
                        <p style="color:#94a3b8;">Tap the <b>URL</b> button at bottom-right to set your server IP/HTTPS address.</p>
                        </body></html>
                    """.trimIndent()
                    view?.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
                }
            }
        }

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.loadUrl(getSavedUrl())
    }

    private fun getSavedUrl(): String {
        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        return prefs.getString(keyUrl, BuildConfig.DASHBOARD_URL) ?: BuildConfig.DASHBOARD_URL
    }

    private fun saveUrl(url: String) {
        val prefs = getSharedPreferences(prefsName, Context.MODE_PRIVATE)
        prefs.edit().putString(keyUrl, url.trim()).apply()
    }

    private fun showUrlDialog() {
        val input = EditText(this).apply {
            setText(getSavedUrl())
            hint = "https://your-dashboard-host or http://192.168.1.10:3000"
        }
        AlertDialog.Builder(this)
            .setTitle("Dashboard Server URL")
            .setView(input)
            .setPositiveButton("Save & Load") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.startsWith("http://") || newUrl.startsWith("https://")) {
                    saveUrl(newUrl)
                    webView.loadUrl(newUrl)
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
