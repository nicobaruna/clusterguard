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
        String from = remoteMessage.getFrom();
        String messageId = remoteMessage.getMessageId();
        String title = getTitle(remoteMessage, data);
        String body = getBody(remoteMessage, data);

        Log.e("ClusterGuardFCM", "onMessageReceived:start type=" + type + " from=" + from + " messageId=" + messageId);
        Log.e("ClusterGuardFCM", "onMessageReceived:data=" + data);
        Log.e("ClusterGuardFCM", "onMessageReceived:notification=" + (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "null"));
        Log.e("ClusterGuardFCM", "onMessageReceived:parsedTitle=" + title + " body=" + body);

        Intent fallbackLaunch = new Intent(this, SosAlarmActivity.class);
        fallbackLaunch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fallbackLaunch.putExtra(SosAlarmService.EXTRA_TITLE, title);
        fallbackLaunch.putExtra(SosAlarmService.EXTRA_BODY, body);
        try {
            startActivity(fallbackLaunch);
            Log.e("ClusterGuardFCM", "fallback-activity-launched");
        } catch (Exception error) {
            Log.e("ClusterGuardFCM", "fallback-activity-launch-failed", error);
        }

        try {
            PushNotificationsPlugin.sendRemoteMessage(remoteMessage);
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "PushNotificationsPlugin.sendRemoteMessage failed", error);
        }

        if (!"sos_alert".equals(type)) {
            Log.e("ClusterGuardFCM", "onMessageReceived:ignored non-sos type=" + type);
            return;
        }

        Intent activityIntent = new Intent(this, SosAlarmActivity.class);
        activityIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        activityIntent.putExtra(SosAlarmService.EXTRA_TITLE, title);
        activityIntent.putExtra(SosAlarmService.EXTRA_BODY, body);
        try {
            startActivity(activityIntent);
            Log.e("ClusterGuardFCM", "onMessageReceived:started SosAlarmActivity directly");
        } catch (Exception error) {
            Log.e("ClusterGuardFCM", "onMessageReceived:failed to start SosAlarmActivity", error);
        }

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
