package com.clusterguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class SosAlarmService extends Service {
    public static final String ACTION_START = "com.clusterguard.app.action.START_SOS_ALARM";
    public static final String ACTION_STOP = "com.clusterguard.app.action.STOP_SOS_ALARM";
    public static final String EXTRA_TITLE = "extra_title";
    public static final String EXTRA_BODY = "extra_body";
    public static final String EXTRA_STOP_ALARM = "stop_sos_alarm";
    public static final String EXTRA_OPEN_APP = "open_app";
    public static final String CHANNEL_ID = "sos_alerts_v2";
    private static final int NOTIFICATION_ID = 9001;

    public static void stopNow(Context context) {
        Intent stopIntent = new Intent(context, SosAlarmService.class);
        stopIntent.setAction(ACTION_STOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(stopIntent);
        } else {
            context.startService(stopIntent);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopAlarmAndService();
            return START_NOT_STICKY;
        }

        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(EXTRA_BODY) : null;
        if (title == null || title.isEmpty()) {
            title = "SOS ClusterGuard";
        }
        if (body == null || body.isEmpty()) {
            body = "Ada laporan darurat baru.";
        }

        ensureSosChannel();
        Notification notification = buildAlarmNotification(title, body);
        startForeground(NOTIFICATION_ID, notification);
        showAlarmActivity(title, body);
        AlarmSosPlayer.start(this);

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        AlarmSosPlayer.stop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopAlarmAndService() {
        AlarmSosPlayer.stop();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
        }
        stopForeground(true);
        stopSelf();
    }

    private void showAlarmActivity(String title, String body) {
        Intent fullScreenIntent = new Intent(this, SosAlarmActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra(EXTRA_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_BODY, body);
        startActivity(fullScreenIntent);
    }

    private Notification buildAlarmNotification(String title, String body) {
        Intent fullScreenIntent = new Intent(this, SosAlarmActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra(EXTRA_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_BODY, body);

        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openAppIntent.putExtra(EXTRA_STOP_ALARM, true);
        openAppIntent.putExtra(EXTRA_OPEN_APP, true);

        int mutableFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1001, openAppIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(this, 1003, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        Intent stopIntent = new Intent(this, SosAlarmActionReceiver.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(this, 1002, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setContentIntent(contentIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(0, "Matikan Alarm", stopPendingIntent)
            .build();
    }

    private void ensureSosChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        NotificationChannel existingChannel = manager.getNotificationChannel(CHANNEL_ID);
        if (existingChannel != null) {
            return;
        }

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "SOS ClusterGuard",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Alarm darurat SOS ClusterGuard");
        channel.enableLights(true);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/alarm_sos");
        channel.setSound(soundUri, audioAttributes);

        manager.createNotificationChannel(channel);
    }
}
