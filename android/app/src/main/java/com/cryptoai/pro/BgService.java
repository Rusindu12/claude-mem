package com.cryptoai.pro;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * Foreground service started while the trading bot runs, so Android does not
 * freeze the WebView timers or the network bridge when the app goes to background.
 */
public class BgService extends Service {

    static final int ID = 4242;
    static volatile boolean autoOn = false;
    static volatile boolean tradingActive = false;

    static void start(Context c, String text) {
        Intent i = new Intent(c, BgService.class);
        i.putExtra("text", text);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                c.startForegroundService(i);
            } else {
                c.startService(i);
            }
        } catch (Exception ignored) {
        }
    }

    static void stop(Context c) {
        try {
            c.stopService(new Intent(c, BgService.class));
        } catch (Exception ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent == null ? null : intent.getStringExtra("text");
        if (text == null) text = "CryptoAI PRO bot running";

        Notifier.ensureChannels(this);
        Intent open = new Intent(this, MainActivity.class);
        int pflags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) pflags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, pflags);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, Notifier.CH_BOT)
                : new Notification.Builder(this);
        b.setSmallIcon(R.drawable.ic_stat_logo)
                .setContentTitle("CryptoAI PRO")
                .setContentText(text)
                .setOngoing(true)
                .setContentIntent(pi)
                .setShowWhen(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) b.setColor(0xFFF0B90B);

        startForeground(ID, b.build());
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        autoOn = false;
        tradingActive = false;
        super.onDestroy();
    }
}
