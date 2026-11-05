package app.campusnet.ui

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.withFrameNanos
import kotlin.math.hypot
import kotlin.random.Random

private class Node(val x: Float, val y: Float, val vx: Float, val vy: Float, val r: Float)

@Composable
fun MeshBackground(modifier: Modifier = Modifier, alpha: Float = 1f) {
    val nodes = remember {
        val rnd = Random(7)
        List(34) { Node(rnd.nextFloat(), rnd.nextFloat(), (rnd.nextFloat() - 0.5f) * 0.03f, (rnd.nextFloat() - 0.5f) * 0.03f, 1.2f + rnd.nextFloat() * 1.8f) }
    }
    var nanos by remember { mutableLongStateOf(0L) }
    LaunchedEffect(Unit) {
        while (true) withFrameNanos { nanos = it }
    }
    val dp = LocalDensity.current.density
    Canvas(modifier) {
        val t = nanos / 1_000_000_000f
        val w = size.width
        val h = size.height
        val reach = minOf(w, h) * 0.3f
        val pts = nodes.map {
            Offset(((it.x + it.vx * t) % 1f + 1f) % 1f * w, ((it.y + it.vy * t) % 1f + 1f) % 1f * h)
        }
        for (i in pts.indices) for (j in i + 1 until pts.size) {
            val d = hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)
            if (d < reach) drawLine(Palette.Neon.copy(alpha = (1f - d / reach) * 0.16f * alpha), pts[i], pts[j], strokeWidth = dp)
        }
        for (i in pts.indices) drawCircle(Palette.Neon.copy(alpha = 0.35f * alpha), nodes[i].r * dp, pts[i])
    }
}

private val outerHex = listOf(24f to 3f, 41f to 13f, 41f to 35f, 24f to 45f, 7f to 35f, 7f to 13f)
private val innerHex = listOf(24f to 14f, 32f to 19f, 32f to 29f, 24f to 34f, 16f to 29f, 16f to 19f)

private fun DrawScope.hexPath(points: List<Pair<Float, Float>>): Path {
    val k = size.minDimension / 48f
    val ox = (size.width - 48f * k) / 2f
    val oy = (size.height - 48f * k) / 2f
    return Path().apply {
        points.forEachIndexed { i, (x, y) -> if (i == 0) moveTo(ox + x * k, oy + y * k) else lineTo(ox + x * k, oy + y * k) }
        close()
    }
}

fun trimPath(path: Path, fraction: Float): Path {
    val measure = PathMeasure().apply { setPath(path, false) }
    val seg = Path()
    measure.getSegment(0f, measure.length * fraction.coerceIn(0f, 1f), seg, true)
    return seg
}

private fun DrawScope.strokeTrimmed(path: Path, fraction: Float, color: Color, width: Float) {
    drawPath(trimPath(path, fraction), color, style = Stroke(width, cap = StrokeCap.Round, join = StrokeJoin.Round))
}

@Composable
fun HexLogo(draw: Float, glow: Float, modifier: Modifier = Modifier, color: Color = Palette.Neon) {
    Canvas(modifier) {
        val k = size.minDimension / 48f
        val outer = hexPath(outerHex)
        val inner = hexPath(innerHex)
        val innerDraw = ((draw - 0.35f) / 0.65f).coerceIn(0f, 1f)
        for ((mul, a) in listOf(4.2f to 0.07f, 2.6f to 0.12f)) {
            strokeTrimmed(outer, draw, color.copy(alpha = a * glow), 2.4f * k * mul / 2f)
            strokeTrimmed(inner, innerDraw, color.copy(alpha = a * glow), 2.2f * k * mul / 2f)
        }
        strokeTrimmed(outer, draw, color, 2.4f * k)
        strokeTrimmed(inner, innerDraw, color, 2.2f * k)
    }
}
