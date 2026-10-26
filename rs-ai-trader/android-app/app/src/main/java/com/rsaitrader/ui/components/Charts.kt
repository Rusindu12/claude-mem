package com.rsaitrader.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rsaitrader.core.format.Fmt
import com.rsaitrader.core.network.KlineDto
import com.rsaitrader.ui.theme.RsColors

/**
 * Candlestick chart with volume histogram and an EMA overlay, drawn with Canvas.
 *
 * Deliberately dependency-free: no third-party chart library and no "dummy"
 * data — the caller always passes real candles from `/market/klines/{symbol}`
 * and the freshness banner is rendered by the screen, not hidden here.
 */
@Composable
fun CandleChart(
    candles: List<KlineDto>,
    modifier: Modifier = Modifier,
    emaPeriod: Int = 20,
    showVolume: Boolean = true,
    height: Int = 260,
) {
    val textMeasurer = rememberTextMeasurer()
    var selected by remember { mutableStateOf<Int?>(null) }

    val labelStyle = TextStyle(fontSize = 9.sp, color = RsColors.TextMuted)
    val body = if (candles.isEmpty()) null else candles

    Box(modifier = modifier.fillMaxWidth()) {
        Canvas(
            modifier = Modifier
                .fillMaxWidth()
                .height(height.dp)
                .pointerInput(candles.size) {
                    detectTapGestures { offset ->
                        val idx = indexAt(offset.x, size.width.toFloat(), candles.size)
                        selected = if (idx != null && idx == selected) null else idx
                    }
                }
                .pointerInput(candles.size) {
                    detectDragGestures(
                        onDragStart = { offset ->
                            selected = indexAt(offset.x, size.width.toFloat(), candles.size)
                        },
                        onDragEnd = { },
                        onDragCancel = { },
                        onDrag = { change, _ ->
                            selected = indexAt(change.position.x, size.width.toFloat(), candles.size)
                        },
                    )
                },
        ) {
            val w = size.width
            val h = size.height
            if (body == null || body.size < 2) {
                drawText(
                    textMeasurer = textMeasurer,
                    text = "No candles available",
                    topLeft = Offset(w / 2f - 60f, h / 2f),
                    style = TextStyle(fontSize = 12.sp, color = RsColors.TextMuted),
                )
                return@Canvas
            }

            val volumeHeight = if (showVolume) h * 0.18f else 0f
            val priceHeight = h - volumeHeight - 4f
            val highs = body.maxOf { it.high }
            val lows = body.minOf { it.low }
            val span = (highs - lows).takeIf { it > 0.0 } ?: 1.0
            val maxVolume = body.maxOf { it.volume }.takeIf { it > 0.0 } ?: 1.0

            fun yFor(price: Double): Float = (priceHeight * (1 - (price - lows) / span)).toFloat()

            // horizontal grid + price labels
            val gridLines = 4
            for (i in 0..gridLines) {
                val price = lows + span * (i.toDouble() / gridLines)
                val y = yFor(price)
                drawLine(
                    color = RsColors.Border.copy(alpha = 0.55f),
                    start = Offset(0f, y),
                    end = Offset(w, y),
                    strokeWidth = 1f,
                )
                drawText(
                    textMeasurer = textMeasurer,
                    text = Fmt.price(price),
                    topLeft = Offset(4f, (y - 11f).coerceAtLeast(0f)),
                    style = labelStyle,
                )
            }

            val slot = w / body.size
            val candleWidth = (slot * 0.62f).coerceAtLeast(1.5f)

            body.forEachIndexed { index, candle ->
                val x = slot * index + slot / 2f
                val up = candle.close >= candle.open
                val color = if (up) RsColors.Emerald else RsColors.Danger
                val highY = yFor(candle.high)
                val lowY = yFor(candle.low)
                val openY = yFor(candle.open)
                val closeY = yFor(candle.close)

                drawLine(color = color, start = Offset(x, highY), end = Offset(x, lowY), strokeWidth = 1.2f)
                val top = minOf(openY, closeY)
                val bottomTotal = maxOf(openY, closeY)
                drawRect(
                    color = color,
                    topLeft = Offset(x - candleWidth / 2f, top),
                    size = Size(candleWidth, (bottomTotal - top).coerceAtLeast(1.2f)),
                )

                if (showVolume) {
                    val volHeight = (candle.volume / maxVolume * volumeHeight).toFloat()
                    drawRect(
                        color = color.copy(alpha = 0.35f),
                        topLeft = Offset(x - candleWidth / 2f, h - volHeight),
                        size = Size(candleWidth, volHeight),
                    )
                }
            }

            // EMA overlay
            val ema = ema(body.map { it.close }, emaPeriod)
            val path = Path()
            var started = false
            ema.forEachIndexed { index, value ->
                if (value == null) return@forEachIndexed
                val x = slot * index + slot / 2f
                val y = yFor(value)
                if (!started) {
                    path.moveTo(x, y); started = true
                } else {
                    path.lineTo(x, y)
                }
            }
            if (started) {
                drawPath(path, color = RsColors.Info.copy(alpha = 0.85f), style = Stroke(width = 1.6f))
            }

            // crosshair + tooltip for the touched candle
            val idx = selected
            if (idx != null && idx in body.indices) {
                val candle = body[idx]
                val x = slot * idx + slot / 2f
                drawLine(
                    color = RsColors.TextSecondary.copy(alpha = 0.6f),
                    start = Offset(x, 0f),
                    end = Offset(x, h),
                    strokeWidth = 1f,
                )
                val lines = listOf(
                    Fmt.day(candle.time) + " " + Fmt.time(candle.time),
                    "O ${Fmt.price(candle.open)}  H ${Fmt.price(candle.high)}",
                    "L ${Fmt.price(candle.low)}  C ${Fmt.price(candle.close)}",
                    "Vol ${Fmt.compactVolume(candle.volume)}",
                )
                lines.forEachIndexed { lineIndex, line ->
                    drawText(
                        textMeasurer = textMeasurer,
                        text = line,
                        topLeft = Offset(8f, 6f + lineIndex * 12f),
                        style = TextStyle(fontSize = 9.5.sp, color = RsColors.TextPrimary),
                    )
                }
            }
        }
        if (selected == null) {
            Text(
                "Tap or drag the chart for candle details",
                style = MaterialTheme.typography.labelSmall,
                color = RsColors.TextMuted,
                modifier = Modifier.align(Alignment.BottomEnd).padding(6.dp),
            )
        }
    }
}

private fun indexAt(x: Float, width: Float, count: Int): Int? {
    if (count <= 0 || width <= 0f) return null
    val idx = ((x / width) * count).toInt()
    return idx.coerceIn(0, count - 1)
}

private fun ema(values: List<Double>, period: Int): List<Double?> {
    if (values.size < period || period <= 1) return List(values.size) { null }
    val multiplier = 2.0 / (period + 1)
    val out = MutableList<Double?>(values.size) { null }
    var prev = values.take(period).average()
    out[period - 1] = prev
    for (i in period until values.size) {
        prev = (values[i] - prev) * multiplier + prev
        out[i] = prev
    }
    return out
}

/** Equity / P&L sparkline used by analytics and portfolio screens. */
@Composable
fun LineChart(
    points: List<Double>,
    modifier: Modifier = Modifier,
    height: Int = 140,
    color: Color = RsColors.Emerald,
) {
    val textMeasurer = rememberTextMeasurer()
    Canvas(modifier = modifier.fillMaxWidth().height(height.dp)) {
        if (points.size < 2) {
            drawText(
                textMeasurer = textMeasurer,
                text = "Not enough data yet",
                topLeft = Offset(size.width / 2f - 55f, size.height / 2f),
                style = TextStyle(fontSize = 11.sp, color = RsColors.TextMuted),
            )
            return@Canvas
        }
        val min = points.minOrNull() ?: 0.0
        val max = points.maxOrNull() ?: 0.0
        val span = (max - min).takeIf { it > 0.0 } ?: 1.0
        val path = Path()
        val fill = Path()
        points.forEachIndexed { index, value ->
            val x = size.width * index / (points.size - 1).toFloat()
            val y = (size.height - 8f) * (1 - ((value - min) / span)).toFloat() + 4f
            if (index == 0) {
                path.moveTo(x, y); fill.moveTo(x, size.height); fill.lineTo(x, y)
            } else {
                path.lineTo(x, y); fill.lineTo(x, y)
            }
        }
        fill.lineTo(size.width, size.height)
        fill.close()
        drawPath(fill, color = color.copy(alpha = 0.13f))
        drawPath(path, color = color, style = Stroke(width = 2f))
        drawText(
            textMeasurer = textMeasurer,
            text = Fmt.price(max),
            topLeft = Offset(2f, 0f),
            style = TextStyle(fontSize = 9.sp, color = RsColors.TextMuted),
        )
        drawText(
            textMeasurer = textMeasurer,
            text = Fmt.price(min),
            topLeft = Offset(2f, size.height - 12f),
            style = TextStyle(fontSize = 9.sp, color = RsColors.TextMuted),
        )
    }
}

/** Two-sided depth bars (bids left, asks right). */
@Composable
fun DepthBars(bids: List<List<Double>>, asks: List<List<Double>>, modifier: Modifier = Modifier, height: Int = 90) {
    val textMeasurer = rememberTextMeasurer()
    Canvas(modifier = modifier.fillMaxWidth().height(height.dp)) {
        val maxQty = (bids.take(10).mapNotNull { it.getOrNull(1) } + asks.take(10).mapNotNull { it.getOrNull(1) })
            .maxOrNull() ?: 0.0
        if (maxQty <= 0.0) {
            drawText(
                textMeasurer = textMeasurer,
                text = "Order book unavailable",
                topLeft = Offset(size.width / 2f - 55f, size.height / 2f),
                style = TextStyle(fontSize = 11.sp, color = RsColors.TextMuted),
            )
            return@Canvas
        }
        val half = size.width / 2f
        bids.take(10).forEachIndexed { index, level ->
            val qty = level.getOrNull(1) ?: 0.0
            val barWidth = (qty / maxQty * half * 0.92f).toFloat()
            val barHeight = size.height / 10f
            drawRect(
                color = RsColors.Emerald.copy(alpha = 0.30f),
                topLeft = Offset(half - barWidth, index * barHeight),
                size = Size(barWidth, barHeight - 1.5f),
            )
        }
        asks.take(10).forEachIndexed { index, level ->
            val qty = level.getOrNull(1) ?: 0.0
            val barWidth = (qty / maxQty * half * 0.92f).toFloat()
            val barHeight = size.height / 10f
            drawRect(
                color = RsColors.Danger.copy(alpha = 0.30f),
                topLeft = Offset(half, index * barHeight),
                size = Size(barWidth, barHeight - 1.5f),
            )
        }
        drawLine(
            color = RsColors.Border,
            start = Offset(half, 0f),
            end = Offset(half, size.height),
            strokeWidth = 1f,
        )
    }
}
