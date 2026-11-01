package com.cryptoai.pro;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONObject;

/**
 * Exchange API credentials. Stored in the app's private SharedPreferences
 * (encrypted at rest by the OS on modern devices, unreadable by other apps).
 */
final class Keys {

    private static final String PREFS = "cryptoai_keys";

    private final SharedPreferences sp;

    Keys(Context c) {
        sp = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    String key(String ex) {
        return sp.getString(ex + "_key", "");
    }

    String secret(String ex) {
        return sp.getString(ex + "_secret", "");
    }

    boolean testnet(String ex) {
        return sp.getBoolean(ex + "_testnet", false);
    }

    void save(String ex, String apiKey, String apiSecret, boolean testnet) {
        sp.edit()
                .putString(ex + "_key", apiKey == null ? "" : apiKey.trim())
                .putString(ex + "_secret", apiSecret == null ? "" : apiSecret.trim())
                .putBoolean(ex + "_testnet", testnet)
                .apply();
    }

    void clear(String ex) {
        sp.edit()
                .remove(ex + "_key")
                .remove(ex + "_secret")
                .remove(ex + "_testnet")
                .apply();
    }

    String status(String ex) {
        String k = key(ex);
        boolean has = k != null && !k.isEmpty() && secret(ex) != null && !secret(ex).isEmpty();
        String preview = "";
        if (has) {
            preview = k.length() <= 8 ? k.substring(0, 2) + "…" : k.substring(0, 4) + "…" + k.substring(k.length() - 4);
        }
        try {
            JSONObject o = new JSONObject();
            o.put("hasKeys", has);
            o.put("keyPreview", preview);
            o.put("testnet", testnet(ex));
            o.put("base", base(ex));
            return o.toString();
        } catch (Exception e) {
            return "{\"hasKeys\":false}";
        }
    }

    String base(String ex) {
        if ("bybit".equals(ex)) {
            return testnet(ex) ? "https://api-testnet.bybit.com" : "https://api.bybit.com";
        }
        return testnet(ex) ? "https://testnet.binance.vision" : "https://api.binance.com";
    }
}
