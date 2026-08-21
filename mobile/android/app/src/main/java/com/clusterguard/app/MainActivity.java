package com.clusterguard.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;

public class MainActivity extends BridgeActivity {
	private static final String PREFS_NAME = "cluster_guard_native";
	private static final String KEY_FCM_TOKEN = "fcm_token";
	private static final String TAG = "ClusterGuardFCM";
	private static final int REQ_NOTIFICATION_PERMISSION = 1001;

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		handleAlarmStopIntent(getIntent());
		requestNotificationPermissionIfNeeded();
		requestNativeFcmToken();
		startKeepAliveService();
		clearCacheIfVersionChanged();
		setupJsBridge();
	}

	private void setupJsBridge() {
		try {
			if (getBridge() != null && getBridge().getWebView() != null) {
				getBridge().getWebView().addJavascriptInterface(this, "NativeBridge");
			}
		} catch (Exception error) {
			Log.w(TAG, "setup-js-bridge failed", error);
		}
	}

	@android.webkit.JavascriptInterface
	public void clearCache() {
		runOnUiThread(() -> {
			clearWebViewCache();
		});
	}

	@android.webkit.JavascriptInterface
	public void reloadApp() {
		runOnUiThread(() -> {
			if (getBridge() != null && getBridge().getWebView() != null) {
				getBridge().getWebView().reload();
			}
		});
	}

	private void clearCacheIfVersionChanged() {
		try {
			String currentVersion = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
			SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
			String lastVersion = prefs.getString("last_app_version", "");

			if (!currentVersion.equals(lastVersion)) {
				Log.d(TAG, "version-changed: " + lastVersion + " -> " + currentVersion + "; clearing webview cache");
				if (getBridge() != null && getBridge().getWebView() != null) {
					getBridge().getWebView().clearCache(true);
				}
				prefs.edit().putString("last_app_version", currentVersion).apply();
			}
		} catch (Exception error) {
			Log.w(TAG, "clear-cache-if-version-changed failed", error);
		}
	}

	public void clearWebViewCache() {
		try {
			if (getBridge() != null && getBridge().getWebView() != null) {
				getBridge().getWebView().clearCache(true);
				Log.d(TAG, "webview-cache-cleared");
			}
		} catch (Exception error) {
			Log.w(TAG, "clear-webview-cache failed", error);
		}
	}

	private void startKeepAliveService() {
		try {
			KeepAliveService.start(this);
		} catch (Exception error) {
			Log.w(TAG, "failed-to-start-keep-alive-service", error);
		}
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

	private void requestNotificationPermissionIfNeeded() {
		if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
			return;
		}
		if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
			Log.d(TAG, "notification-permission-already-granted");
			return;
		}
		Log.d(TAG, "requesting-notification-permission");
		ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.POST_NOTIFICATIONS}, REQ_NOTIFICATION_PERMISSION);
	}

	@Override
	public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
		super.onRequestPermissionsResult(requestCode, permissions, grantResults);
		if (requestCode == REQ_NOTIFICATION_PERMISSION) {
			if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
				Log.d(TAG, "notification-permission-granted");
				Toast.makeText(this, "Izin notifikasi aktif, alarm SOS siap diterima", Toast.LENGTH_SHORT).show();
				new Handler(Looper.getMainLooper()).postDelayed(this::requestNativeFcmToken, 1000);
			} else {
				Log.w(TAG, "notification-permission-denied");
				Toast.makeText(this, "Izin notifikasi belum aktif, alarm mungkin tidak muncul", Toast.LENGTH_LONG).show();
			}
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
			if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
				if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
					Log.w(TAG, "notification-permission-not-granted-yet; skipping FCM token request");
					return;
				}
			}

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
				dispatchNativeFcmTokenToWebView(token);
				new Handler(Looper.getMainLooper()).postDelayed(() -> dispatchNativeFcmTokenToWebView(token), 1500);
				new Handler(Looper.getMainLooper()).postDelayed(() -> dispatchNativeFcmTokenToWebView(token), 4000);
			});
		}, 2000);
	}

	private void dispatchNativeFcmTokenToWebView(String token) {
		if (token == null || token.trim().isEmpty()) {
			return;
		}

		String escapedToken = token.replace("\\", "\\\\").replace("\"", "\\\"");
		String script = "if (window) { window.__CLUSTERGUARD_NATIVE_FCM_TOKEN__ = \"" + escapedToken + "\"; window.dispatchEvent(new CustomEvent('native-fcm-token', {detail: {token: \"" + escapedToken + "\"}})); }";

		try {
			if (getBridge() != null && getBridge().getWebView() != null) {
				getBridge().getWebView().post(() -> {
					try {
						getBridge().getWebView().evaluateJavascript(script, null);
					} catch (Exception error) {
						Log.w(TAG, "Failed to dispatch native FCM token to webview", error);
					}
				});
			}
		} catch (Exception error) {
			Log.w(TAG, "Failed to dispatch native FCM token to webview", error);
		}
	}
}
