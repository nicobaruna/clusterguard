package com.clusterguard.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Menyalakan ulang KeepAliveService setelah HP reboot (BOOT_COMPLETED).
 * Android mengizinkan start foreground service dari broadcast ini
 * (pengecualian background-start FGS).
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)) {
            KeepAliveService.start(context);
        }
    }
}
