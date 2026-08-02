package com.clusterguard.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class SosAlarmActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        setContentView(R.layout.activity_sos_alarm);
        bindContent(getIntent());
        bindActions();
        handleStopOnTap(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        bindContent(intent);
        handleStopOnTap(intent);
    }

    private void handleStopOnTap(Intent intent) {
        if (intent != null && intent.getBooleanExtra(SosAlarmService.EXTRA_STOP_ALARM, false)) {
            SosAlarmService.stopNow(this);
        }
    }

    private void configureWindow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
            );
        }
    }

    private void bindContent(Intent intent) {
        TextView titleView = findViewById(R.id.sos_alarm_title);
        TextView bodyView = findViewById(R.id.sos_alarm_body);

        String title = intent != null ? intent.getStringExtra(SosAlarmService.EXTRA_TITLE) : null;
        String body = intent != null ? intent.getStringExtra(SosAlarmService.EXTRA_BODY) : null;

        titleView.setText(title == null || title.isEmpty() ? getString(R.string.sos_alarm_title_default) : title);
        bodyView.setText(body == null || body.isEmpty() ? getString(R.string.sos_alarm_body_default) : body);
    }

    private void bindActions() {
        Button openButton = findViewById(R.id.sos_alarm_open_button);
        Button stopButton = findViewById(R.id.sos_alarm_stop_button);

        openButton.setOnClickListener((view) -> {
            SosAlarmService.stopNow(this);

            Intent openAppIntent = new Intent(this, MainActivity.class);
            openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openAppIntent.putExtra(SosAlarmService.EXTRA_STOP_ALARM, true);
            openAppIntent.putExtra(SosAlarmService.EXTRA_OPEN_APP, true);
            startActivity(openAppIntent);
            finish();
        });

        stopButton.setOnClickListener((view) -> {
            SosAlarmService.stopNow(this);
            finish();
        });
    }
}