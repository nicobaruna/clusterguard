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
        Map<String, String> data = remoteMessage.getData();
        String type = data != null ? data.get("type") : null;
        String from = remoteMessage.getFrom();
        String messageId = remoteMessage.getMessageId();
        String title = getTitle(remoteMessage, data);
        String body = getBody(remoteMessage, data);

        android.util.Log.d("ClusterGuardFCM", "onMessageReceived:start type=" + type + " from=" + from + " messageId=" + messageId);
        android.util.Log.d("ClusterGuardFCM", "onMessageReceived:data=" + data);
        android.util.Log.d("ClusterGuardFCM", "onMessageReceived:notification=" + (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "null"));
        android.util.Log.d("ClusterGuardFCM", "onMessageReceived:parsedTitle=" + title + " body=" + body);

        try {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "PushNotificationsPlugin.sendRemoteMessage failed", error);
        }

        if (!"sos_alert".equals(type)) {
            android.util.Log.d("ClusterGuardFCM", "onMessageReceived:ignored non-sos type=" + type);
            return;
        }

        Intent startIntent = new Intent(this, SosAlarmService.class);
        startIntent.setAction(SosAlarmService.ACTION_START);
        startIntent.putExtra(SosAlarmService.EXTRA_TITLE, title);
        startIntent.putExtra(SosAlarmService.EXTRA_BODY, body);
        try {
            ContextCompat.startForegroundService(this, startIntent);
            android.util.Log.d("ClusterGuardFCM", "onMessageReceived:started SosAlarmService");
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "onMessageReceived:failed to start SosAlarmService", error);
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
