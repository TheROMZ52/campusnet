package app.campusnet

import android.app.Activity
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import app.campusnet.bridge.Channels
import app.campusnet.bridge.Visibility
import app.campusnet.data.Address
import app.campusnet.data.ServerStore
import app.campusnet.ui.ConnectScreen
import app.campusnet.ui.WebScreen

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        Channels.ensure(this)
        val store = ServerStore(this)
        setContent { Root(store) }
    }

    override fun onStart() {
        super.onStart()
        Visibility.foreground = true
    }

    override fun onStop() {
        Visibility.foreground = false
        super.onStop()
    }
}

@Composable
private fun Root(store: ServerStore) {
    val activity = LocalContext.current as Activity
    var origin by rememberSaveable { mutableStateOf(store.last()) }
    var name by rememberSaveable { mutableStateOf("") }
    if (origin.isEmpty()) {
        ConnectScreen(store) { o, n -> origin = o; name = n }
    } else {
        WebScreen(
            origin = origin,
            name = name.ifEmpty { Address.label(origin) },
            store = store,
            onChangeServer = { store.setLast(""); origin = ""; name = "" },
            onExit = { activity.finish() },
        )
    }
}
