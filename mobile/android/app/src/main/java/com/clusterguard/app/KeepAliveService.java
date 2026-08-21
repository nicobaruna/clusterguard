package com.clusterguard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

/**
 * Foreground service keep-alive supaya proses ClusterGuard jarang dibunuh
 * oleh pengelola baterai/Deep Sleep Samsung.
 *
 * Dengan service ini app menampilkan notifikasi permanen "ClusterGuard aktif"
 * (channel keep_alive, importance LOW, tanpa suara). Karena prosesnya hidup,
 * FCM onMessageReceived selalu bisa dipanggil dan alarm SOS tetap berjalan
 * walau app tidak sedang dibuka.
 */
public class KeepAliveService extends Service {
    public static final String ACTION_START = "com.clusterguard.app.action.START_KEEP_ALIVE";
    public static final String ACTION_STOP = "com.clusterguard.app.action.STOP_KEEP_ALIVE";
    public static final String CHANNEL_ID = "keep_alive";
    private static final int NOTIFICATION_ID = 9003;

    /** Mulai keep-alive. Aman dipanggil dari foreground (MainActivity) atau BOOT_COMPLETED. */
    public static void start(Context context) {
        Intent intent = new Intent(context, KeepAliveService.class);
        intent.setAction(ACTION_START);
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "KeepAliveService start failed", error);
        }
    }

    public static void stop(Context context) {
        Intent intent = new Intent(context, KeepAliveService.class);
        intent.setAction(ACTION_STOP);
        context.startService(intent);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        ensureKeepAliveChannel();
        Notification notification = buildKeepAliveNotification();
        try {
            startForeground(NOTIFICATION_ID, notification);
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "KeepAliveService startForeground failed", error);
            try {
                NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
                if (manager != null) {
                    manager.notify(NOTIFICATION_ID, notification);
                }
            } catch (Exception ignored) {
            }
        }
        // START_STICKY: jika proses sempat dibunuh sistem, Android mencoba
        // menghidupkannya lagi dengan intent null.
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private Notification buildKeepAliveNotification() {
        Intent launchIntent = new Intent(this, MainActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int mutableFlag = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
        PendingIntent contentIntent = PendingIntent.getActivity(this, 3001, launchIntent, PendingIntent.FLAG_UPDATE_CURRENT | mutableFlag);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("ClusterGuard aktif")
            .setContentText("Notifikasi darurat SOS siap diterima")
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(contentIntent)
            .build();
    }

    private void ensureKeepAliveChannel() {
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
                "Keep Alive ClusterGuard",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Notifikasi permanen agar ClusterGuard tetap berjalan");
            channel.enableLights(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            channel.setShowBadge(false);
            manager.createNotificationChannel(channel);
        }
    }
}
