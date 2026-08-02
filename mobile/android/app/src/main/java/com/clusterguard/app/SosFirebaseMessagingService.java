package com.clusterguard.app;

import android.content.Intent;
import android.text.TextUtils;

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
        android.util.Log.d("ClusterGuardFCM", "onMessageReceived:data=" + remoteMessage.getData());
        android.util.Log.d("ClusterGuardFCM", "onMessageReceived:notification=" + (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "null"));
        PushNotificationsPlugin.sendRemoteMessage(remoteMessage);

        Map<String, String> data = remoteMessage.getData();
        String type = data != null ? data.get("type") : null;
        if (!"sos_alert".equals(type)) {
            return;
        }

        String title = getTitle(remoteMessage, data);
        String body = getBody(remoteMessage, data);

        Intent startIntent = new Intent(this, SosAlarmService.class);
        startIntent.setAction(SosAlarmService.ACTION_START);
        startIntent.putExtra(SosAlarmService.EXTRA_TITLE, title);
        startIntent.putExtra(SosAlarmService.EXTRA_BODY, body);
        ContextCompat.startForegroundService(this, startIntent);
    }

    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
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
