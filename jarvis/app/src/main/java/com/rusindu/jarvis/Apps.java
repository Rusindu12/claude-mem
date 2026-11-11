package com.rusindu.jarvis;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;

import java.util.List;
import java.util.Locale;

/** Finds and launches installed apps by their visible name. */
final class Apps {

    private Apps() {
    }

    static boolean launch(Context ctx, String name) {
        if (name == null) {
            return false;
        }
        String want = name.trim().toLowerCase(Locale.ROOT);
        if (want.isEmpty()) {
            return false;
        }
        try {
            PackageManager pm = ctx.getPackageManager();
            Intent main = new Intent(Intent.ACTION_MAIN);
            main.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> apps = pm.queryIntentActivities(main, 0);
            String exact = null;
            String partial = null;
            for (ResolveInfo ri : apps) {
                String label = String.valueOf(ri.loadLabel(pm)).toLowerCase(Locale.ROOT);
                String pkg = ri.activityInfo.packageName;
                if (label.isEmpty()) {
                    continue;
                }
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
            ctx.startActivity(launch);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
