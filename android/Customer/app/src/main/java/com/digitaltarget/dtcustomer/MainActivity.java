package com.digitaltarget.dtcustomer;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * DT Customer app shell.
 *
 * The only thing added over the stock Capacitor activity is the notification
 * channel. From Android 8 (API 26) a notification posted to a channel that was
 * never created is silently dropped, so the channel the server addresses —
 * "dt_orders", the channel_id in push-dispatch — has to exist before the first
 * message arrives. Creating a channel that already exists is a no-op, so this
 * is safe to run on every launch.
 */
public class MainActivity extends BridgeActivity {

    private static final String ORDER_CHANNEL_ID = "dt_orders";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createOrderChannel();
    }

    private void createOrderChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel channel = new NotificationChannel(
                ORDER_CHANNEL_ID,
                getString(R.string.order_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(getString(R.string.order_channel_description));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }
}
