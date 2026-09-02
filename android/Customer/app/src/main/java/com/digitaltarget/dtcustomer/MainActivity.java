package com.digitaltarget.dtcustomer;

import com.getcapacitor.BridgeActivity;

/**
 * DT Customer app shell.
 *
 * Stock Capacitor. The "dt_orders" notification channel that used to be
 * created here existed only so FCM messages had a channel to land in; with
 * Firebase removed (v1.30.0) nothing posts a notification, so creating the
 * channel would put an empty "Order updates" entry in the phone's notification
 * settings that could never produce one.
 *
 * Order alerts happen in-app over Supabase while the app is open.
 */
public class MainActivity extends BridgeActivity {
}
