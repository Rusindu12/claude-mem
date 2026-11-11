package com.rusindu.jarvis;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Bundle;
import android.provider.AlarmClock;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * J.A.R.V.I.S — a thin native shell around the web UI in assets/www.
 * The native side supplies what a WebView cannot do on its own:
 * speech recognition, text-to-speech (both with Sinhala support) and device actions.
 */
public class MainActivity extends Activity {

    private static final int REQ_MIC = 1001;

    private WebView webView;
    private SpeechRecognizer recognizer;
    private TextToSpeech tts;
    private volatile boolean ttsReady = false;
    private String pendingListenLang = null;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF03080F);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme())) {
                    return false;
                }
                openExternal(uri.toString());
                return true;
            }
        });
        webView.addJavascriptInterface(new Bridge(), "JarvisNative");
        setContentView(webView);

        tts = new TextToSpeech(this, status -> {
            ttsReady = (status == TextToSpeech.SUCCESS);
            if (ttsReady) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String utteranceId) {
                        emit("tts_start", "");
                    }

                    @Override
                    public void onDone(String utteranceId) {
                        emit("tts_done", "");
                    }

                    @Override
                    public void onError(String utteranceId) {
                        emit("tts_done", "");
                    }
                });
            }
            emit("tts_ready", ttsReady ? "1" : "0");
        });

        webView.loadUrl("file:///android_asset/www/index.html");
    }

    /** Send an event to the web UI: window.JarvisBridge.onEvent(type, data). */
    private void emit(final String type, final String data) {
        runOnUiThread(() -> {
            if (webView == null) {
                return;
            }
            String js = "window.JarvisBridge&&window.JarvisBridge.onEvent("
                    + JSONObject.quote(type) + "," + JSONObject.quote(data == null ? "" : data) + ")";
            webView.evaluateJavascript(js, null);
        });
    }

    private boolean openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    // ---------------------------------------------------------------- speech in

    private void beginListening(String lang) {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingListenLang = lang;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            emit("stt_error", "unavailable");
            return;
        }
        if (tts != null) {
            tts.stop();
        }
        if (recognizer != null) {
            recognizer.destroy();
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(this);
        recognizer.setRecognitionListener(new RecognitionListener() {
            @Override
            public void onReadyForSpeech(Bundle params) {
                emit("stt_ready", "");
            }

            @Override
            public void onBeginningOfSpeech() {
            }

            @Override
            public void onRmsChanged(float rmsdB) {
            }

            @Override
            public void onBufferReceived(byte[] buffer) {
            }

            @Override
            public void onEndOfSpeech() {
                emit("stt_end", "");
            }

            @Override
            public void onError(int error) {
                String code;
                switch (error) {
                    case SpeechRecognizer.ERROR_NO_MATCH:
                    case SpeechRecognizer.ERROR_SPEECH_TIMEOUT:
                        code = "nospeech";
                        break;
                    case SpeechRecognizer.ERROR_NETWORK:
                    case SpeechRecognizer.ERROR_NETWORK_TIMEOUT:
                    case SpeechRecognizer.ERROR_SERVER:
                        code = "network";
                        break;
                    case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS:
                        code = "permission";
                        break;
                    case SpeechRecognizer.ERROR_CLIENT:
                        code = "cancelled";
                        break;
                    default:
                        code = "error" + error;
                }
                emit("stt_error", code);
            }

            @Override
            public void onResults(Bundle results) {
                emit("stt_final", first(results));
            }

            @Override
            public void onPartialResults(Bundle partialResults) {
                String t = first(partialResults);
                if (!t.isEmpty()) {
                    emit("stt_partial", t);
                }
            }

            @Override
            public void onEvent(int eventType, Bundle params) {
            }

            private String first(Bundle b) {
                if (b == null) {
                    return "";
                }
                ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                return (list == null || list.isEmpty() || list.get(0) == null) ? "" : list.get(0);
            }
        });

        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        intent.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
        try {
            recognizer.startListening(intent);
        } catch (Exception e) {
            emit("stt_error", "unavailable");
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != REQ_MIC) {
            return;
        }
        String lang = pendingListenLang;
        pendingListenLang = null;
        if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED && lang != null) {
            beginListening(lang);
        } else {
            emit("stt_error", "permission");
        }
    }

    // --------------------------------------------------------------- speech out

    private void say(String text, String lang) {
        if (!ttsReady || tts == null) {
            emit("tts_missing", lang);
            emit("tts_done", "");
            return;
        }
        int r = tts.setLanguage(Locale.forLanguageTag(lang));
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) {
            emit("tts_missing", lang);
            emit("tts_done", "");
            return;
        }
        tts.setPitch(0.95f);
        tts.setSpeechRate(1.0f);
        int max = TextToSpeech.getMaxSpeechInputLength() - 1;
        if (text.length() > max) {
            text = text.substring(0, max);
        }
        Bundle params = new Bundle();
        int res = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, "jarvis-" + System.nanoTime());
        if (res != TextToSpeech.SUCCESS) {
            emit("tts_done", "");
        }
    }

    // ------------------------------------------------------------------- bridge

    private class Bridge {

        @JavascriptInterface
        public void startListening(final String lang) {
            runOnUiThread(() -> beginListening(lang));
        }

        @JavascriptInterface
        public void stopListening() {
            runOnUiThread(() -> {
                if (recognizer != null) {
                    recognizer.cancel();
                }
            });
        }

        @JavascriptInterface
        public void speak(final String text, final String lang) {
            runOnUiThread(() -> say(text, lang));
        }

        @JavascriptInterface
        public void stopSpeaking() {
            runOnUiThread(() -> {
                if (tts != null) {
                    tts.stop();
                }
            });
        }

        @JavascriptInterface
        public boolean isTtsReady() {
            return ttsReady;
        }

        @JavascriptInterface
        public boolean openUrl(String url) {
            return openExternal(url);
        }

        /** Launch an installed app whose label matches the given name. */
        @JavascriptInterface
        public boolean openApp(String name) {
            if (name == null) {
                return false;
            }
            String want = name.trim().toLowerCase(Locale.ROOT);
            if (want.isEmpty()) {
                return false;
            }
            try {
                PackageManager pm = getPackageManager();
                Intent main = new Intent(Intent.ACTION_MAIN);
                main.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
                String exact = null;
                String partial = null;
                for (ResolveInfo ri : apps) {
                    String label = String.valueOf(ri.loadLabel(pm)).toLowerCase(Locale.ROOT);
                    String pkg = ri.activityInfo.packageName;
                    if (label.equals(want)) {
                        exact = pkg;
                        break;
                    }
                    if (partial == null && (label.contains(want) || want.contains(label)
                            || pkg.toLowerCase(Locale.ROOT).contains(want.replace(" ", "")))) {
                        partial = pkg;
                    }
                }
                String pkg = exact != null ? exact : partial;
                if (pkg == null) {
                    return false;
                }
                Intent launch = pm.getLaunchIntentForPackage(pkg);
                if (launch == null) {
                    return false;
                }
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(launch);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean dial(String number) {
            try {
                Intent i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setAlarm(int hour, int minute, String message) {
            try {
                Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
                i.putExtra(AlarmClock.EXTRA_HOUR, hour);
                i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
                i.putExtra(AlarmClock.EXTRA_MESSAGE, message == null ? "J.A.R.V.I.S" : message);
                i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean setTimer(int seconds, String message) {
            try {
                Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
                i.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
                i.putExtra(AlarmClock.EXTRA_MESSAGE, message == null ? "J.A.R.V.I.S" : message);
                i.putExtra(AlarmClock.EXTRA_SKIP_UI, true);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
                return true;
            } catch (Exception e) {
                return false;
            }
        }

        @JavascriptInterface
        public boolean torch(boolean on) {
            try {
                CameraManager cm = (CameraManager) getSystemService(Context.CAMERA_SERVICE);
                for (String id : cm.getCameraIdList()) {
                    Boolean flash = cm.getCameraCharacteristics(id).get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
                    if (flash != null && flash) {
                        cm.setTorchMode(id, on);
                        return true;
                    }
                }
            } catch (Exception e) {
                return false;
            }
            return false;
        }

        @JavascriptInterface
        public int battery() {
            try {
                BatteryManager bm = (BatteryManager) getSystemService(Context.BATTERY_SERVICE);
                return bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);
            } catch (Exception e) {
                return -1;
            }
        }
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    public void onBackPressed() {
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (tts != null) {
            tts.stop();
            tts.shutdown();
            tts = null;
        }
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
