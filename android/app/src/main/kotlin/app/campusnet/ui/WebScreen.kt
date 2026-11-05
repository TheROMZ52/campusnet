package app.campusnet.ui

import android.Manifest
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.SslErrorHandler
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import app.campusnet.BuildConfig
import app.campusnet.R
import app.campusnet.bridge.AppBridge
import app.campusnet.data.ServerStore
import app.campusnet.service.KeepAliveService

private const val LOGIN_LAYOUT_PATCH = """
(function () {
  var login = document.getElementById('login');
  if (!login || document.getElementById('campusnet-android-login-layout')) return;
  var style = document.createElement('style');
  style.id = 'campusnet-android-login-layout';
  style.textContent = [
    '#login { display:flex !important; flex-direction:column !important; align-items:center !important; justify-content:flex-start !important; flex:1 1 0 !important; min-height:0 !important; width:100% !important; overflow-x:hidden !important; overflow-y:auto !important; padding-top:12px !important; padding-bottom:12px !important; }',
    '.gate { flex:0 0 auto !important; width:min(420px,100%) !important; max-height:none !important; overflow:visible !important; margin-top:auto !important; margin-bottom:auto !important; }',
    '@media(max-height:700px) { .gate { padding:18px 18px 16px !important; gap:13px !important; } #loginForm { gap:10px !important; } }'
  ].join('');
  (document.head || document.documentElement).appendChild(style);
})();
"""

private class Holder {
    var web: WebView? = null
    var mic: PermissionRequest? = null
    var files: ValueCallback<Array<Uri>>? = null
}

private fun askBattery(ctx: Context, store: ServerStore) {
    if (store.batteryAsked()) return
    store.setBatteryAsked()
    runCatching {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        if (!pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
            ctx.startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}")),
            )
        }
    }
}

@Composable
fun WebScreen(origin: String, name: String, store: ServerStore, onChangeServer: () -> Unit, onExit: () -> Unit) {
    val ctx = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val holder = remember { Holder() }
    var progress by remember { mutableIntStateOf(0) }
    var ready by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var securityFailure by remember { mutableStateOf(false) }
    var failureDetail by remember { mutableStateOf("") }
    var failedUrl by remember { mutableStateOf(origin) }
    var menu by remember { mutableStateOf(false) }

    val micLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val req = holder.mic
        holder.mic = null
        if (granted) req?.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req?.deny()
    }
    val chooser = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        holder.files?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(r.resultCode, r.data))
        holder.files = null
    }
    val notifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { askBattery(ctx, store) }

    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifications.launch(Manifest.permission.POST_NOTIFICATIONS) else askBattery(ctx, store)
    }

    DisposableEffect(Unit) {
        ContextCompat.startForegroundService(ctx, Intent(ctx, KeepAliveService::class.java).putExtra("name", name))
        onDispose {
            ctx.stopService(Intent(ctx, KeepAliveService::class.java))
            holder.web?.destroy()
            holder.web = null
        }
    }

    BackHandler {
        val web = holder.web
        when {
            menu -> menu = false
            !failed && web != null && web.canGoBack() -> web.goBack()
            else -> menu = true
        }
    }

    Box(Modifier.fillMaxSize().background(Palette.Bg)) {
        Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.systemBars.union(WindowInsets.ime))) {
            AndroidView(
                modifier = Modifier.fillMaxSize().graphicsLayer { alpha = if (failed) 0f else 1f },
                factory = { c ->
                    WebView(c).apply {
                        holder.web = this
                        setBackgroundColor(0xFF050706.toInt())
                        overScrollMode = View.OVER_SCROLL_NEVER
                        CookieManager.getInstance().setAcceptCookie(true)
                        settings.apply {
                            javaScriptEnabled = true
                            domStorageEnabled = true
                            mediaPlaybackRequiresUserGesture = false
                            allowFileAccess = false
                            setSupportZoom(false)
                            cacheMode = WebSettings.LOAD_DEFAULT
                            userAgentString = userAgentString + " CampusNetApp/" + BuildConfig.VERSION_NAME
                        }
                        setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
                        addJavascriptInterface(AppBridge(c.applicationContext), "CampusNetApp")
                        setDownloadListener { url, agent, disposition, mime, _ ->
                            runCatching {
                                val request = DownloadManager.Request(Uri.parse(url)).apply {
                                    setMimeType(mime)
                                    addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url).orEmpty())
                                    addRequestHeader("User-Agent", agent)
                                    setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, URLUtil.guessFileName(url, disposition, mime))
                                }
                                (c.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
                            }
                        }
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                                val home = Uri.parse(origin)
                                val u = request.url
                                if (u.scheme == home.scheme && u.host == home.host && u.port == home.port) return false
                                runCatching { c.startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                                return true
                            }

                            override fun onPageFinished(view: WebView, url: String?) {
                                if (!failed) {
                                    view.evaluateJavascript(LOGIN_LAYOUT_PATCH, null)
                                    ready = true
                                }
                            }

                            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                                handler.cancel()
                                failedUrl = error.url?.takeIf { it.startsWith("https://") || it.startsWith("http://") } ?: origin
                                securityFailure = true
                                failureDetail = ctx.getString(R.string.ssl_certificate_invalid)
                                ready = true
                                failed = true
                            }

                            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                                if (request.isForMainFrame && response.statusCode >= 400) {
                                    failedUrl = request.url.toString()
                                    securityFailure = false
                                    failureDetail = ctx.getString(R.string.http_error_code, response.statusCode)
                                    ready = true
                                    failed = true
                                }
                            }

                            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                                if (request.isForMainFrame) {
                                    failedUrl = request.url.toString()
                                    securityFailure = false
                                    failureDetail = error.description?.toString().orEmpty()
                                    ready = true
                                    failed = true
                                }
                            }
                        }
                        webChromeClient = object : WebChromeClient() {
                            override fun onProgressChanged(view: WebView, newProgress: Int) {
                                progress = newProgress
                            }

                            override fun onPermissionRequest(request: PermissionRequest) {
                                if (!request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                                    request.deny()
                                    return
                                }
                                if (ContextCompat.checkSelfPermission(c, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                    request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
                                } else {
                                    holder.mic?.deny()
                                    holder.mic = request
                                    micLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                }
                            }

                            override fun onShowFileChooser(
                                webView: WebView,
                                callback: ValueCallback<Array<Uri>>,
                                params: WebChromeClient.FileChooserParams,
                            ): Boolean {
                                holder.files?.onReceiveValue(null)
                                holder.files = callback
                                return try {
                                    chooser.launch(params.createIntent())
                                    true
                                } catch (e: Exception) {
                                    holder.files = null
                                    false
                                }
                            }
                        }
                        loadUrl(origin)
                    }
                },
            )
        }

        val bar by animateFloatAsState(progress / 100f, tween(250), label = "progress")
        AnimatedVisibility(progress in 1..99 && !failed, Modifier.statusBarsPadding(), enter = fadeIn(), exit = fadeOut(tween(300))) {
            Box(Modifier.fillMaxWidth().height(2.5.dp)) {
                Box(Modifier.fillMaxWidth(bar).height(2.5.dp).background(Palette.Neon))
            }
        }

        AnimatedVisibility(!ready && !failed, enter = EnterTransition.None, exit = fadeOut(tween(500)) + scaleOut(tween(500), targetScale = 1.08f)) {
            LoadingLayer(name)
        }

        AnimatedVisibility(
            failed,
            enter = fadeIn(tween(300)) + slideInVertically(spring(dampingRatio = 0.85f, stiffness = 300f)) { it / 14 },
            exit = fadeOut(tween(250)),
        ) {
            Box(Modifier.fillMaxSize().background(Palette.Bg)) {
                MeshBackground(Modifier.fillMaxSize(), alpha = 0.5f)
                Column(
                    Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 36.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
                ) {
                    HexLogo(0.78f, 0.4f, Modifier.size(96.dp), Palette.Danger)
                    Spacer(Modifier.height(22.dp))
                    Text(
                        stringResource(if (securityFailure) R.string.security_error_title else R.string.connection_lost),
                        color = Palette.Text,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.SemiBold,
                        textAlign = TextAlign.Center,
                    )
                    Spacer(Modifier.height(12.dp))
                    Text(
                        stringResource(if (securityFailure) R.string.security_error_message else R.string.connection_error_message),
                        color = Palette.Dim,
                        fontSize = 14.sp,
                        textAlign = TextAlign.Center,
                    )
                    if (failureDetail.isNotBlank()) {
                        Spacer(Modifier.height(8.dp))
                        Text(failureDetail, color = Palette.Danger, fontSize = 12.sp, textAlign = TextAlign.Center)
                    }
                    Spacer(Modifier.height(24.dp))
                    Pill(stringResource(R.string.retry), true) {
                        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                        failed = false
                        securityFailure = false
                        failureDetail = ""
                        failedUrl = origin
                        ready = false
                        holder.web?.loadUrl(origin)
                    }
                    Spacer(Modifier.height(10.dp))
                    Pill(stringResource(R.string.open_in_browser), false) {
                        val target = Uri.parse(failedUrl)
                        runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, target).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                    }
                    Spacer(Modifier.height(10.dp))
                    Pill(stringResource(R.string.change_server), false, onChangeServer)
                }
            }
        }

        AnimatedVisibility(menu, enter = fadeIn(tween(220)), exit = fadeOut(tween(220))) {
            Box(Modifier.fillMaxSize().background(Palette.Bg.copy(alpha = 0.72f)).clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { menu = false })
        }
        AnimatedVisibility(
            menu,
            Modifier.align(Alignment.BottomCenter),
            enter = slideInVertically(spring(dampingRatio = 0.82f, stiffness = 320f)) { it } + fadeIn(tween(200)),
            exit = slideOutVertically(tween(220)) { it } + fadeOut(tween(200)),
        ) {
            val shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)
            Column(
                Modifier.fillMaxWidth().clip(shape).background(Palette.Surface).border(1.dp, Palette.Line, shape)
                    .navigationBarsPadding().padding(horizontal = 28.dp, vertical = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Pill(stringResource(R.string.change_server), true) {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    menu = false
                    onChangeServer()
                }
                Spacer(Modifier.height(12.dp))
                Pill(stringResource(R.string.exit), false, onExit)
            }
        }
    }
}

@Composable
private fun LoadingLayer(name: String) {
    val t = rememberInfiniteTransition(label = "loading")
    val draw by t.animateFloat(0.05f, 1f, infiniteRepeatable(tween(1500, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "draw")
    val glow by t.animateFloat(0.4f, 1f, infiniteRepeatable(tween(1500, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "glow")
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) { appear.animateTo(1f, tween(600, easing = FastOutSlowInEasing)) }
    Box(Modifier.fillMaxSize().background(Palette.Bg)) {
        MeshBackground(Modifier.fillMaxSize())
        Column(
            Modifier.fillMaxSize(),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
        ) {
            HexLogo(draw, glow, Modifier.size(120.dp))
            Spacer(Modifier.height(22.dp))
            Text(name, color = Palette.Dim, fontSize = 15.sp, letterSpacing = 1.sp, modifier = Modifier.graphicsLayer { alpha = appear.value })
        }
    }
}

@Composable
private fun Pill(label: String, primary: Boolean, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.96f else 1f, spring(stiffness = 600f), label = "pill")
    val shape = RoundedCornerShape(28.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .height(56.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(shape)
            .background(if (primary) Palette.Neon else Palette.Bg)
            .border(1.dp, if (primary) Palette.Neon else Palette.Line, shape)
            .clickable(interactionSource = source, indication = null, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, color = if (primary) Palette.Bg else Palette.Text, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
    }
}
