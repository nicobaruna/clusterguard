package com.clusterguard.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

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
    private static final int FALLBACK_NOTIFICATION_ID = 9002;
    private static final long ALARM_REPEAT_INTERVAL_MS = 4000L;
    private final Handler alarmHandler = new Handler(Looper.getMainLooper());
    private final Runnable alarmRepeatRunnable = new Runnable() {
        @Override
        public void run() {
            if (currentTitle == null || currentTitle.isEmpty()) {
                return;
            }
            AlarmSosPlayer.restart(SosAlarmService.this);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildAlarmNotification(currentTitle, currentBody));
            }
            alarmHandler.postDelayed(this, ALARM_REPEAT_INTERVAL_MS);
        }
    };
    private String currentTitle;
    private String currentBody;
    private PowerManager.WakeLock wakeLock;

    public static void stopNow(Context context) {
        Intent stopIntent = new Intent(context, SosAlarmService.class);
        stopIntent.setAction(ACTION_STOP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                context.startForegroundService(stopIntent);
            } catch (Exception ignored) {
                context.startService(stopIntent);
            }
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
        acquireWakeLock();
        currentTitle = title;
        currentBody = body;
        Notification notification = buildAlarmNotification(title, body);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    android.util.Log.w("ClusterGuardFCM", "post-notifications-permission-not-granted; skipping foreground notification display");
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                }
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "startForeground failed", error);
            try {
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(NOTIFICATION_ID, notification);
                }
            } catch (Exception ignored) {
            }
        }
        final String alarmTitle = title;
        final String alarmBody = body;
        alarmHandler.postDelayed(() -> {
            try {
                showAlarmActivity(alarmTitle, alarmBody);
            } catch (Exception error) {
                android.util.Log.w("ClusterGuardFCM", "showAlarmActivity failed", error);
            }
        }, 400L);
        AlarmSosPlayer.start(this);
        alarmHandler.removeCallbacks(alarmRepeatRunnable);
        AlarmSosPlayer.restart(this);
        alarmHandler.postDelayed(alarmRepeatRunnable, 1000L);

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        AlarmSosPlayer.stop();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopAlarmAndService() {
        alarmHandler.removeCallbacks(alarmRepeatRunnable);
        AlarmSosPlayer.stop();
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) {
            manager.cancel(NOTIFICATION_ID);
            manager.cancel(FALLBACK_NOTIFICATION_ID);
        }
        currentTitle = null;
        currentBody = null;
        releaseWakeLock();
        stopForeground(true);
        stopSelf();
    }

    private void showAlarmActivity(String title, String body) {
        Intent fullScreenIntent = new Intent(this, SosAlarmActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NO_USER_ACTION);
        fullScreenIntent.putExtra(EXTRA_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_BODY, body);
        try {
            startActivity(fullScreenIntent);
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "Failed to launch full-screen SOS activity", error);
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.notify(FALLBACK_NOTIFICATION_ID, buildFallbackNotification(title, body));
            }
        }
    }

    private Notification buildAlarmNotification(String title, String body) {
        Intent fullScreenIntent = new Intent(this, SosAlarmActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra(EXTRA_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_BODY, body);

        Intent tappedIntent = new Intent(this, SosAlarmActivity.class);
        tappedIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        tappedIntent.putExtra(EXTRA_TITLE, title);
        tappedIntent.putExtra(EXTRA_BODY, body);
        tappedIntent.putExtra(EXTRA_STOP_ALARM, true);

        int mutableFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1001, tappedIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(this, 1003, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        Intent stopIntent = new Intent(this, SosAlarmActionReceiver.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(this, 1002, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/alarm_sos");

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setSound(soundUri, AudioManager.STREAM_ALARM)
            .setVibrate(new long[]{0, 1000, 500, 1000})
            .setLights(Color.RED, 1000, 1000)
            .setContentIntent(contentIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(0, "Lihat Alarm", contentIntent)
            .addAction(0, "Matikan Alarm", stopPendingIntent)
            .setTicker(title)
            .build();
    }

    private Notification buildFallbackNotification(String title, String body) {
        Intent fullScreenIntent = new Intent(this, SosAlarmActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra(EXTRA_TITLE, title);
        fullScreenIntent.putExtra(EXTRA_BODY, body);

        Intent tappedIntent = new Intent(this, SosAlarmActivity.class);
        tappedIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        tappedIntent.putExtra(EXTRA_TITLE, title);
        tappedIntent.putExtra(EXTRA_BODY, body);

        int mutableFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 1004, tappedIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(this, 1005, fullScreenIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        Intent stopIntent = new Intent(this, SosAlarmActionReceiver.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(this, 1006, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/alarm_sos");

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("SOS ALERT")
            .setContentText(body)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(false)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setSound(soundUri, AudioManager.STREAM_ALARM)
            .setVibrate(new long[]{0, 1000, 500, 1000})
            .setLights(Color.RED, 1000, 1000)
            .setContentIntent(contentIntent)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .addAction(0, "Lihat Alarm", contentIntent)
            .addAction(0, "Matikan Alarm", stopPendingIntent)
            .setTicker(title)
            .build();
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            return;
        }
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager == null) {
            return;
        }
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "ClusterGuard:SosAlarm");
        wakeLock.acquire(60 * 1000L);
    }

    private void releaseWakeLock() {
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) {
                    wakeLock.release();
                }
            } catch (Exception ignored) {
            }
            wakeLock = null;
        }
    }

    private void ensureSosChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) {
            return;
        }

        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
        if (channel == null) {
            channel = new NotificationChannel(
                CHANNEL_ID,
                "SOS ClusterGuard",
                NotificationManager.IMPORTANCE_HIGH
            );
        }

        channel.setDescription("Alarm darurat SOS ClusterGuard");
        channel.enableLights(true);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setBypassDnd(true);
        channel.setImportance(NotificationManager.IMPORTANCE_MAX);
        channel.setDescription("Alarm darurat SOS ClusterGuard - sangat penting");

        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        Uri soundUri = Uri.parse("android.resource://" + getPackageName() + "/raw/alarm_sos");
        channel.setSound(soundUri, audioAttributes);

        manager.createNotificationChannel(channel);
    }
}
