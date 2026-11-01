package com.cryptoai.pro;

import android.app.Activity;
import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.speech.tts.TextToSpeech;
import android.util.Log;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

import java.util.Locale;

/**
 * window.AndroidBridge — every method here is callable from the web app.
 * Blocking network work is fine: JavaScript interface calls run on a dedicated
 * bridge thread, never on the UI thread.
 */
public class Bridge {

    private static final String TAG = "CryptoAIPro";

    private final Activity activity;
    private TextToSpeech tts;
    private ToneGenerator tones;
    private final Keys keys;

    Bridge(Activity a) {
        this.activity = a;
        this.keys = new Keys(a);
        try {
            tones = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 70);
        } catch (Exception ignored) {
        }
        tts = new TextToSpeech(a, status -> {
            if (status == TextToSpeech.SUCCESS && tts != null) {
                tts.setLanguage(Locale.US);
            }
        });
    }

    void shutdown() {
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Exception ignored) {
            }
            tts = null;
        }
        if (tones != null) {
            tones.release();
            tones = null;
        }
    }

    /* ------------------------------------------------------------ info */

    @JavascriptInterface
    public String version() {
        return BuildConfig.VERSION_NAME;
    }

    @JavascriptInterface
    public String platform() {
        return "Android " + Build.VERSION.RELEASE + " · sdk " + Build.VERSION.SDK_INT;
    }

    /* -------------------------------------------------------- feedback */

    @JavascriptInterface
    public void haptic(int ms) {
        Vibrator v = (Vibrator) activity.getSystemService(Context.VIBRATOR_SERVICE);
        if (v == null || !v.hasVibrator()) return;
        int d = Math.max(10, Math.min(1000, ms));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(d, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            v.vibrate(d);
        }
    }

    @JavascriptInterface
    public void beep(int freq) {
        try {
            if (tones != null) tones.startTone(ToneGenerator.TONE_PROP_BEEP, 120);
        } catch (Exception ignored) {
        }
    }

    @JavascriptInterface
    public void speak(String text) {
        if (text == null || tts == null) return;
        try {
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "cryptoai");
        } catch (Exception e) {
            Log.w(TAG, "tts", e);
        }
    }

    @JavascriptInterface
    public void notifySignal(String title, String text) {
        Notifier.show(activity, title == null ? "CryptoAI PRO" : title, text == null ? "" : text);
    }

    /* ----------------------------------------------------------- window */

    @JavascriptInterface
    public void setKeepScreenOn(final boolean on) {
        activity.runOnUiThread(() -> {
            try {
                if (on) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            } catch (Exception ignored) {
            }
        });
    }

    /** The page asks for this while the bot runs; the foreground service keeps it alive. */
    @JavascriptInterface
    public void setAutoOn(boolean on) {
        BgService.autoOn = on;
    }

    @JavascriptInterface
    public void setTradingActive(boolean on) {
        BgService.tradingActive = on;
    }

    @JavascriptInterface
    public void startBgService(String text) {
        BgService.start(activity, text == null ? "CryptoAI PRO bot running" : text);
    }

    @JavascriptInterface
    public void stopBgService() {
        BgService.stop(activity);
    }

    /* ----------------------------------------------------------- network */

    @JavascriptInterface
    public String httpGet(String url, String headersJson) {
        try {
            return Http.get(url, headersJson);
        } catch (Exception e) {
            return err(e);
        }
    }

    @JavascriptInterface
    public String httpPost(String url, String body, String headersJson) {
        try {
            return Http.post(url, body, headersJson);
        } catch (Exception e) {
            return err(e);
        }
    }

    /* ------------------------------------------------------ trading keys */

    // The web app calls these by exchange name, e.g. AndroidBridge.binanceSigned(...)

    @JavascriptInterface
    public String binanceSigned(String method, String path, String paramsJson) {
        try {
            return Binance.sign(keys, method, path, paramsJson);
        } catch (Exception e) {
            return err(e);
        }
    }

    @JavascriptInterface
    public String bybitSigned(String method, String path, String paramsJson) {
        try {
            return Bybit.sign(keys, method, path, paramsJson);
        } catch (Exception e) {
            return err(e);
        }
    }

    @JavascriptInterface
    public String binanceSaveKeys(String apiKey, String apiSecret, boolean testnet) {
        keys.save("binance", apiKey, apiSecret, testnet);
        return "ok";
    }

    @JavascriptInterface
    public String bybitSaveKeys(String apiKey, String apiSecret, boolean testnet) {
        keys.save("bybit", apiKey, apiSecret, testnet);
        return "ok";
    }

    @JavascriptInterface
    public void binanceClearKeys() {
        keys.clear("binance");
    }

    @JavascriptInterface
    public void bybitClearKeys() {
        keys.clear("bybit");
    }

    @JavascriptInterface
    public String binanceStatus() {
        return keys.status("binance");
    }

    @JavascriptInterface
    public String bybitStatus() {
        return keys.status("bybit");
    }

    /* -------------------------------------------------- live trading engine */

    /** Signed request with a normalised, exchange-agnostic envelope. */
    @JavascriptInterface
    public String liveRequest(String exchange, String method, String path, String paramsJson) {
        return LiveTrading.request(keys, exchange, method, path, paramsJson);
    }

    /** Balance check + key permissions + round-trip latency. */
    @JavascriptInterface
    public String exchangeTest(String exchange) {
        return LiveTrading.selfTest(keys, exchange);
    }

    /** Idempotency key for order submission (retry-safe). */
    @JavascriptInterface
    public String clientOrderId(String prefix) {
        return LiveTrading.clientId(prefix);
    }

    /** Device clock, so the page can warn about exchange timestamp drift. */
    @JavascriptInterface
    public long now() {
        return System.currentTimeMillis();
    }

    /** Truthful mode: is the network layer on-device and are keys present? */
    @JavascriptInterface
    public String liveStatus() {
        JSONObject o = new JSONObject();
        try {
            o.put("bridge", true);
            o.put("version", BuildConfig.VERSION_NAME);
            o.put("binanceKeys", keys.key("binance") != null && !keys.key("binance").isEmpty());
            o.put("bybitKeys", keys.key("bybit") != null && !keys.key("bybit").isEmpty());
            o.put("testnet", keys.testnet("binance") || keys.testnet("bybit"));
        } catch (Exception ignored) {
        }
        return o.toString();
    }

    /**
     * Signed exchange request. Params are sent as a JSON string; the request is
     * signed here, on the device, and the secret never reaches the web layer.
     */
    @JavascriptInterface
    public String signed(String exchange, String method, String path, String paramsJson) {
        if ("bybit".equals(exchange)) return Bybit.sign(keys, method, path, paramsJson);
        return Binance.sign(keys, method, path, paramsJson);
    }

    private static String err(Exception e) {
        String msg = e.getMessage();
        if (msg == null) msg = e.getClass().getSimpleName();
        try {
            JSONObject o = new JSONObject();
            o.put("error", true);
            o.put("msg", msg);
            return o.toString();
        } catch (Exception ignored) {
            return "{\"error\":true,\"msg\":\"network error\"}";
        }
    }
}
