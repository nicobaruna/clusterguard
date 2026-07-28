package com.clusterguard.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.MediaPlayer;

public final class AlarmSosPlayer {
    private static MediaPlayer mediaPlayer;

    private AlarmSosPlayer() {}

    public static synchronized void start(Context context) {
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            return;
        }

        stop();

        mediaPlayer = MediaPlayer.create(context.getApplicationContext(), R.raw.alarm_sos);
        if (mediaPlayer == null) {
            return;
        }

        mediaPlayer.setAudioAttributes(
            new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
        );
        mediaPlayer.setLooping(true);
        mediaPlayer.setOnCompletionListener(mp -> stop());
        mediaPlayer.setOnErrorListener((mp, what, extra) -> {
            stop();
            return true;
        });
        mediaPlayer.start();
    }

    public static synchronized void stop() {
        if (mediaPlayer == null) {
            return;
        }

        try {
            if (mediaPlayer.isPlaying()) {
                mediaPlayer.stop();
            }
        } catch (IllegalStateException ignored) {
            // Ignore invalid state during shutdown.
        }

        try {
            mediaPlayer.release();
        } catch (Exception ignored) {
            // Ignore release errors.
        }

        mediaPlayer = null;
    }
}
