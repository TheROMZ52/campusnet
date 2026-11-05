package app.campusnet.bridge

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.campusnet.MainActivity
import app.campusnet.R

object Visibility {
    @Volatile
    var foreground = false
}

object Channels {
    const val CONNECTION = "connection"
    const val MESSAGES = "messages"

    fun ensure(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CONNECTION, ctx.getString(R.string.channel_connection), NotificationManager.IMPORTANCE_MIN).apply { setShowBadge(false) },
        )
        nm.createNotificationChannel(
            NotificationChannel(MESSAGES, ctx.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH),
        )
    }

    fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx,
        0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}

class AppBridge(private val ctx: Context) {
    @JavascriptInterface
    fun notify(title: String?, body: String?) {
        if (Visibility.foreground) return
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val t = title.orEmpty()
        val b = body.orEmpty()
        val n = NotificationCompat.Builder(ctx, Channels.MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(t)
            .setContentText(b)
            .setStyle(NotificationCompat.BigTextStyle().bigText(b))
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(Channels.openApp(ctx))
            .build()
        NotificationManagerCompat.from(ctx).notify(t.hashCode(), n)
    }
}
