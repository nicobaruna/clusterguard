package com.clusterguard.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;

public final class AlarmSosPlayer {
    private static MediaPlayer mediaPlayer;
    private static AudioManager audioManager;
    private static int audioFocusRequestResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED;

    private AlarmSosPlayer() {}

    public static synchronized void start(Context context) {
        restart(context);
    }

    public static synchronized void restart(Context context) {
        if (mediaPlayer != null && mediaPlayer.isPlaying()) {
            return;
        }

        stop();

        Context appContext = context.getApplicationContext();
        audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        if (audioManager != null) {
            audioFocusRequestResult = audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_ALARM,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE
            );
        }

        mediaPlayer = MediaPlayer.create(appContext, R.raw.alarm_sos);
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
        mediaPlayer.setVolume(1.0f, 1.0f);
        mediaPlayer.setOnCompletionListener(null);
        mediaPlayer.setOnErrorListener((mp, what, extra) -> {
            stop();
            return true;
        });
        mediaPlayer.start();
    }

    public static synchronized void stop() {
        if (mediaPlayer != null) {
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

        if (audioManager != null && audioFocusRequestResult == AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            audioManager.abandonAudioFocus(null);
        }
        audioManager = null;
        audioFocusRequestResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED;
    }
}
