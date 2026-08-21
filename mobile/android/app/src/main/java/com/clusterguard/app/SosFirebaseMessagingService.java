package com.clusterguard.app;

import android.content.Intent;
import android.os.Build;
import android.text.TextUtils;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;

import com.capacitorjs.plugins.pushnotifications.PushNotificationsPlugin;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class SosFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(@NonNull RemoteMessage remoteMessage) {
        super.onMessageReceived(remoteMessage);
        Map<String, String> data = remoteMessage.getData();
        String type = data != null ? data.get("type") : null;
        String title = getTitle(remoteMessage, data);
        String body = getBody(remoteMessage, data);
        String sosId = data != null ? data.get("sosId") : null;

        Log.e("ClusterGuardFCM", "onMessageReceived type=" + type + " sosId=" + sosId);

        // Kirim ke Capacitor PushNotifications plugin untuk JS handler
        try {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "PushNotificationsPlugin.sendRemoteMessage failed", error);
        }

        if (!"sos_alert".equals(type)) {
            Log.e("ClusterGuardFCM", "onMessageReceived:ignored non-sos type=" + type);
            return;
        }

        // Cek apakah alarm sudah berjalan untuk SOS yang sama
        if (SosAlarmService.isRunning()) {
            Log.e("ClusterGuardFCM", "onMessageReceived:alarm already running, skipping");
            return;
        }

        // Start SosAlarmService (yang akan handle notifikasi + activity)
        Intent startIntent = new Intent(this, SosAlarmService.class);
        startIntent.setAction(SosAlarmService.ACTION_START);
        startIntent.putExtra(SosAlarmService.EXTRA_TITLE, title);
        startIntent.putExtra(SosAlarmService.EXTRA_BODY, body);
        try {
            ContextCompat.startForegroundService(this, startIntent);
            Log.e("ClusterGuardFCM", "onMessageReceived:started SosAlarmService");
        } catch (Exception error) {
            Log.e("ClusterGuardFCM", "onMessageReceived:failed to start SosAlarmService", error);
        }
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        android.util.Log.d("ClusterGuardFCM", "onNewToken:token=" + token);
        PushNotificationsPlugin.onNewToken(token);
    }

    private String getTitle(RemoteMessage message, Map<String, String> data) {
        if (data != null && !TextUtils.isEmpty(data.get("title"))) {
            return data.get("title");
        }
        if (message.getNotification() != null && !TextUtils.isEmpty(message.getNotification().getTitle())) {
            return message.getNotification().getTitle();
        }
        return "SOS ClusterGuard";
    }

    private String getBody(RemoteMessage message, Map<String, String> data) {
        if (data != null && !TextUtils.isEmpty(data.get("body"))) {
            return data.get("body");
        }
        if (message.getNotification() != null && !TextUtils.isEmpty(message.getNotification().getBody())) {
            return message.getNotification().getBody();
        }
        return "Ada laporan darurat baru.";
    }
}
