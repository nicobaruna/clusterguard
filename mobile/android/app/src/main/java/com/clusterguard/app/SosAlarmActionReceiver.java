package com.clusterguard.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SosAlarmActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        if (SosAlarmService.ACTION_STOP.equals(intent.getAction())) {
            SosAlarmService.stopNow(context);
        }
    }
}
