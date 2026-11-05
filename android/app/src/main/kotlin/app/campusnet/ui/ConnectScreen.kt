package app.campusnet.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.unit.sp
import app.campusnet.R
import app.campusnet.data.Address
import app.campusnet.data.Probe
import app.campusnet.data.ServerStore
import app.campusnet.data.probe
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.hypot
import kotlin.math.max

private enum class Phase { Idle, Checking, Success, Failed }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ConnectScreen(store: ServerStore, onConnected: (origin: String, name: String) -> Unit) {
    val scope = rememberCoroutineScope()
    val haptics = LocalHapticFeedback.current
    val focus = LocalFocusManager.current
    val draw = remember { Animatable(0f) }
    val settle = remember { Animatable(0f) }
    val form = remember { Animatable(0f) }
    val shake = remember { Animatable(0f) }
    val reveal = remember { Animatable(0f) }
    val check = remember { Animatable(0f) }
    var text by rememberSaveable { mutableStateOf("") }
    var phase by remember { mutableStateOf(Phase.Idle) }
    var error by remember { mutableStateOf<Int?>(null) }
    var lastError by remember { mutableIntStateOf(R.string.err_unreachable) }
    var recents by remember { mutableStateOf(store.recent()) }
    var buttonCenter by remember { mutableStateOf(Offset.Zero) }

    val pulse by rememberInfiniteTransition(label = "pulse").animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(1800, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "glow",
    )

    LaunchedEffect(Unit) {
        draw.animateTo(1f, tween(1100, easing = FastOutSlowInEasing))
        launch { settle.animateTo(1f, tween(750, easing = FastOutSlowInEasing)) }
        delay(220)
        form.animateTo(1f, tween(650, easing = FastOutSlowInEasing))
    }

    fun connect(raw: String) {
        if (phase == Phase.Checking || phase == Phase.Success) return
        focus.clearFocus()
        scope.launch {
            phase = Phase.Checking
            error = null
            val list = Address.candidates(raw)
            var result: Probe = Probe.Unreachable
            for (c in list) {
                result = probe(c)
                if (result is Probe.Ok) break
            }
            val ok = result as? Probe.Ok
            if (ok == null) {
                val res = when {
                    list.isEmpty() -> R.string.err_invalid
                    result is Probe.NotCampusNet -> R.string.err_not_campusnet
                    else -> R.string.err_unreachable
                }
                lastError = res
                error = res
                phase = Phase.Failed
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                for (v in listOf(16f, -13f, 9f, -6f, 3f, 0f)) shake.animateTo(v, tween(55))
            } else {
                store.add(ok.origin)
                recents = store.recent()
                phase = Phase.Success
                haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                check.snapTo(0f)
                check.animateTo(1f, tween(320))
                delay(120)
                reveal.animateTo(1f, tween(620, easing = FastOutSlowInEasing))
                onConnected(ok.origin, ok.name)
            }
        }
    }

    Box(Modifier.fillMaxSize().background(Palette.Bg)) {
        MeshBackground(Modifier.fillMaxSize())
        BoxWithConstraints(Modifier.fillMaxSize().systemBarsPadding().imePadding()) {
            val avail = maxHeight
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Spacer(Modifier.height(lerp(((avail - 150.dp) / 2 - 24.dp).coerceAtLeast(12.dp), 40.dp, settle.value)))
                HexLogo(draw.value, pulse, Modifier.size(lerp(150.dp, 84.dp, settle.value)))
                Spacer(Modifier.height(18.dp))
                Text(
                    stringResource(R.string.app_name),
                    color = Palette.Text,
                    fontSize = 26.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 2.sp,
                    modifier = Modifier.graphicsLayer {
                        alpha = form.value
                        translationY = (1f - form.value) * 24.dp.toPx()
                    },
                )
                Spacer(Modifier.height(30.dp))
                Column(
                    Modifier.fillMaxWidth().graphicsLayer {
                        alpha = form.value
                        translationY = (1f - form.value) * 40.dp.toPx()
                        translationX = shake.value.dp.toPx()
                    },
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    AddressField(text, { text = it; if (phase == Phase.Failed) { phase = Phase.Idle; error = null } }, phase == Phase.Failed) { connect(text) }
                    AnimatedVisibility(
                        error != null,
                        enter = fadeIn(tween(250)) + expandVertically(tween(250)),
                        exit = fadeOut(tween(200)) + shrinkVertically(tween(200)),
                    ) {
                        Text(
                            stringResource(lastError),
                            color = Palette.Danger,
                            fontSize = 14.sp,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                    }
                    Spacer(Modifier.height(18.dp))
                    ConnectButton(phase, check.value, { connect(text) }) { buttonCenter = it }
                    Spacer(Modifier.height(26.dp))
                    FlowRow(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        recents.forEachIndexed { i, origin ->
                            key(origin) {
                                Chip(
                                    Address.label(origin),
                                    i,
                                    onClick = { text = Address.label(origin); connect(origin) },
                                    onRemove = { store.remove(origin); recents = store.recent() },
                                )
                            }
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
        if (reveal.value > 0f) {
            Canvas(Modifier.fillMaxSize()) {
                val maxR = hypot(max(buttonCenter.x, size.width - buttonCenter.x), max(buttonCenter.y, size.height - buttonCenter.y))
                val r = maxR * reveal.value
                drawCircle(Palette.Bg, r, buttonCenter)
                drawCircle(Palette.Neon, r, buttonCenter, alpha = 1f - reveal.value * 0.7f, style = Stroke(3.dp.toPx() * (1f - reveal.value) + 1f))
            }
        }
    }
}

@Composable
private fun AddressField(value: String, onChange: (String) -> Unit, failed: Boolean, onGo: () -> Unit) {
    var focused by remember { mutableStateOf(false) }
    val border by animateColorAsState(
        when {
            failed -> Palette.Danger
            focused -> Palette.Neon
            else -> Palette.Line
        },
        tween(250),
        label = "border",
    )
    val glow by animateFloatAsState(if (focused && !failed) 1f else 0f, tween(300), label = "glow")
    val shape = RoundedCornerShape(18.dp)
    Box(
        Modifier
            .fillMaxWidth()
            .height(60.dp)
            .drawBehind {
                if (glow > 0f) drawRoundRect(Palette.Neon.copy(alpha = 0.12f * glow), cornerRadius = CornerRadius(18.dp.toPx()), style = Stroke(10.dp.toPx()))
            }
            .clip(shape)
            .background(Palette.Surface)
            .border(1.5.dp, border, shape)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            BasicTextField(
                value = value,
                onValueChange = onChange,
                singleLine = true,
                textStyle = TextStyle(color = Palette.Text, fontSize = 17.sp, textDirection = TextDirection.Ltr),
                cursorBrush = SolidColor(Palette.Neon),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                keyboardActions = KeyboardActions(onGo = { onGo() }),
                modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
                decorationBox = { inner ->
                    Box {
                        if (value.isEmpty()) Text(stringResource(R.string.address_hint), color = Palette.Dim.copy(alpha = 0.55f), fontSize = 17.sp)
                        inner()
                    }
                },
            )
        }
    }
}

@Composable
private fun ConnectButton(phase: Phase, check: Float, onClick: () -> Unit, onCenter: (Offset) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
        val full = maxWidth
        val collapsed = phase == Phase.Checking || phase == Phase.Success
        val width by animateDpAsState(if (collapsed) 58.dp else full, spring(dampingRatio = 0.75f, stiffness = 380f), label = "width")
        val source = remember { MutableInteractionSource() }
        val pressed by source.collectIsPressedAsState()
        val scale by animateFloatAsState(if (pressed) 0.95f else 1f, spring(stiffness = 600f), label = "press")
        Box(
            Modifier
                .width(width)
                .height(58.dp)
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .onGloballyPositioned { c ->
                    val p = c.positionInRoot()
                    onCenter(Offset(p.x + c.size.width / 2f, p.y + c.size.height / 2f))
                }
                .clip(RoundedCornerShape(29.dp))
                .background(Palette.Neon)
                .clickable(interactionSource = source, indication = null, enabled = !collapsed, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Crossfade(phase, label = "content") { p ->
                when (p) {
                    Phase.Checking -> Spinner()
                    Phase.Success -> CheckMark(check)
                    else -> Text(stringResource(R.string.connect), color = Palette.Bg, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun Spinner() {
    val rotation by rememberInfiniteTransition(label = "spin").animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(900, easing = LinearEasing)),
        label = "rot",
    )
    Canvas(Modifier.size(26.dp).graphicsLayer { rotationZ = rotation }) {
        drawArc(Palette.Bg, 0f, 270f, false, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
    }
}

@Composable
private fun CheckMark(progress: Float) {
    Canvas(Modifier.size(26.dp)) {
        val path = Path().apply {
            moveTo(size.width * 0.18f, size.height * 0.55f)
            lineTo(size.width * 0.42f, size.height * 0.78f)
            lineTo(size.width * 0.84f, size.height * 0.28f)
        }
        drawPath(trimPath(path, progress), Palette.Bg, style = Stroke(3.2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

@Composable
private fun Chip(label: String, index: Int, onClick: () -> Unit, onRemove: () -> Unit) {
    val appear = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(520L + index * 80L)
        appear.animateTo(1f, tween(420, easing = FastOutSlowInEasing))
    }
    val shape = RoundedCornerShape(14.dp)
    Row(
        Modifier
            .graphicsLayer { alpha = appear.value; translationY = (1f - appear.value) * 14.dp.toPx() }
            .clip(shape)
            .background(Palette.Surface)
            .border(1.dp, Palette.Line, shape)
            .clickable(onClick = onClick)
            .padding(start = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Text(label, color = Palette.Text, fontSize = 14.sp)
        }
        Box(Modifier.size(36.dp).clickable(onClick = onRemove), contentAlignment = Alignment.Center) {
            Text("\u00D7", color = Palette.Dim, fontSize = 18.sp)
        }
    }
}
