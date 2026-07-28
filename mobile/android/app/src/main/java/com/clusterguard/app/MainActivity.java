package com.clusterguard.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		handleAlarmStopIntent(getIntent());
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
}
