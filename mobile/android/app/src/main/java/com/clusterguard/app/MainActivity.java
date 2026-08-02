package com.clusterguard.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
	private static final String PREFS_NAME = "cluster_guard_native";
	private static final String KEY_FCM_TOKEN = "fcm_token";
	private static final String TAG = "ClusterGuardFCM";

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		handleAlarmStopIntent(getIntent());
		requestNativeFcmToken();
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);
		handleAlarmStopIntent(intent);
	}

	private void handleAlarmStopIntent(Intent intent) {
		if (intent == null) return;
		if (intent.getBooleanExtra(SosAlarmService.EXTRA_STOP_ALARM, false)) {
			SosAlarmService.stopNow(this);
		}
	}

	private void requestNativeFcmToken() {
		try {
			FirebaseApp.initializeApp(this);
			Log.d(TAG, "firebase-app-initialized");
		} catch (Exception error) {
			Log.w(TAG, "firebase-app-init-failed", error);
		}

		new Handler(Looper.getMainLooper()).postDelayed(() -> {
			FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
				if (!task.isSuccessful()) {
					Exception error = task.getException();
					Log.w(TAG, "Failed to retrieve FCM token: " + (error != null ? error.getMessage() : "unknown"), error);
					return;
				}

				String token = task.getResult();
				if (token == null || token.trim().isEmpty()) {
					Log.w(TAG, "FCM token was empty");
					return;
				}

				Log.d(TAG, "native-token=" + token);
				SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
				prefs.edit().putString(KEY_FCM_TOKEN, token).apply();

				if (getBridge() != null && getBridge().getWebView() != null) {
					String script = "window.dispatchEvent(new CustomEvent('native-fcm-token', {detail: {token: \"" + token.replace("\\", "\\\\").replace("\"", "\\\"") + "\"}}));";
					getBridge().getWebView().evaluateJavascript(script, null);
				}
			});
		}, 2000);
	}
}
