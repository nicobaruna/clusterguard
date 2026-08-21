package com.clusterguard.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;

public final class AlarmSosPlayer {
    private static MediaPlayer mediaPlayer;
    private static AudioManager audioManager;
    private static int audioFocusRequestResult = AudioManager.AUDIOFOCUS_REQUEST_FAILED;

    private AlarmSosPlayer() {}

    public static synchronized void start(Context context) {
        restart(context);
    }

    public static synchronized void restart(Context context) {
        // Jika masih berbunyi, biarkan (loop internal MediaPlayer menangani kelanjutan).
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

        // Bangun MediaPlayer manual: AudioAttributes HARUS di-set sebelum prepare()
        // (MediaPlayer.create() sudah prepare, sehingga setAudioAttributes setelahnya
        // ditolak framework: "trying to set audio attributes called in state 8").
        MediaPlayer player = new MediaPlayer();
        try {
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            );

            Uri soundUri = Uri.parse("android.resource://" + appContext.getPackageName() + "/raw/alarm_sos");
            player.setDataSource(appContext, soundUri);
            player.setLooping(true); // Loop hingga stop() dipanggil (user men-tap tombol matikan)
            player.setVolume(1.0f, 1.0f);
            player.setOnErrorListener((mp, what, extra) -> {
                stop();
                return true;
            });
            player.prepare();
            mediaPlayer = player;
            mediaPlayer.start();
        } catch (Exception error) {
            android.util.Log.w("ClusterGuardFCM", "AlarmSosPlayer prepare/start failed", error);
            try {
                player.release();
            } catch (Exception ignored) {
                // Ignore release errors.
            }
            mediaPlayer = null;
        }
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
