package com.cryptoai.pro;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

/** Signal alerts (price crossing, bot trades). */
final class Notifier {

    static final String CH_ALERTS = "alerts";
    static final String CH_BOT = "bot";

    private Notifier() {}

    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel a = new NotificationChannel(CH_ALERTS, "Signals & alerts", NotificationManager.IMPORTANCE_HIGH);
        a.setDescription("Price alerts and AI signal notifications");
        nm.createNotificationChannel(a);
        NotificationChannel b = new NotificationChannel(CH_BOT, "Bot service", NotificationManager.IMPORTANCE_LOW);
        b.setDescription("Keeps the trading bot running in the background");
        nm.createNotificationChannel(b);
    }

    static void show(Context c, String title, String text) {
        ensureChannels(c);
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        Intent i = new Intent(c, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getActivity(c, 0, i, flags);

        Notification.Builder b = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(c, CH_ALERTS)
                : new Notification.Builder(c);
        b.setSmallIcon(R.drawable.ic_stat_logo)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setWhen(System.currentTimeMillis());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            b.setColor(0xFFF0B90B);
        }
        try {
            nm.notify((int) (System.currentTimeMillis() % 100000), b.build());
        } catch (Exception ignored) {
        }
    }
}
