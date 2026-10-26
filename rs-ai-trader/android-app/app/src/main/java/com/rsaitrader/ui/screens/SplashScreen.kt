package com.rsaitrader.ui.screens

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.rsaitrader.ui.components.PrimaryButton
import com.rsaitrader.ui.theme.MonoStyle
import com.rsaitrader.ui.theme.RsColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Splash while the stored session is validated against the backend. */
@Composable
fun SplashScreen() {
    var progress by remember { mutableStateOf(0f) }
    LaunchedEffect(Unit) {
        while (progress < 1f) {
            delay(40)
            progress += 0.04f
        }
    }
    val animated by animateFloatAsState(targetValue = progress.coerceAtMost(1f), animationSpec = tween(400), label = "splash")

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(RsColors.Black, RsColors.Navy, RsColors.Black))),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            LogoMark(size = 96)
            Spacer(Modifier.height(20.dp))
            Text(
                "RS AI TRADER",
                style = MaterialTheme.typography.displaySmall,
                color = RsColors.TextPrimary,
                fontWeight = FontWeight.Bold,
                letterSpacing = 2.sp,
            )
            Text(
                "AI-assisted Binance spot trading",
                style = MaterialTheme.typography.bodyMedium,
                color = RsColors.TextMuted,
            )
            Spacer(Modifier.height(28.dp))
            Box(
                Modifier
                    .width(160.dp)
                    .height(3.dp)
                    .clip(CircleShape)
                    .background(RsColors.Border),
            ) {
                Box(
                    Modifier
                        .fillMaxWidth(animated)
                        .height(3.dp)
                        .clip(CircleShape)
                        .background(RsColors.Emerald),
                )
            }
            Spacer(Modifier.height(12.dp))
            Text("Connecting to backend…", style = MonoStyle, color = RsColors.TextMuted)
        }
        Text(
            "Not financial advice. Trading involves risk of loss.",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 28.dp),
        )
    }
}

@Composable
fun LogoMark(size: Int = 64) {
    Canvas(modifier = Modifier.size(size.dp)) {
        val w = this.size.width
        val h = this.size.height
        drawCircle(
            brush = Brush.radialGradient(
                colors = listOf(RsColors.Emerald.copy(alpha = 0.35f), Color.Transparent),
                center = Offset(w / 2, h / 2),
                radius = w / 2,
            ),
            radius = w / 2,
        )
        val barWidth = w * 0.14f
        val heights = listOf(0.32f, 0.55f, 0.78f, 0.48f)
        heights.forEachIndexed { index, ratio ->
            val left = w * 0.18f + index * (barWidth + w * 0.08f)
            val barHeight = h * ratio
            drawRoundRect(
                color = if (index == heights.lastIndex) RsColors.EmeraldGlow else RsColors.Emerald.copy(alpha = 0.75f),
                topLeft = Offset(left, h - barHeight - h * 0.1f),
                size = androidx.compose.ui.geometry.Size(barWidth, barHeight),
                cornerRadius = androidx.compose.ui.geometry.CornerRadius(barWidth / 2),
            )
        }
    }
}

private data class OnboardPage(val title: String, val body: String, val icon: ImageVector)

private val pages = listOf(
    OnboardPage(
        title = "Analyse before you trade",
        body = "Trend, momentum, volatility and support/resistance are computed on real Binance candles. " +
            "Signals are BUY, SELL or HOLD — with reasons, levels and invalidation conditions. " +
            "No invented confidence percentages.",
        icon = Icons.Filled.CandlestickChart,
    ),
    OnboardPage(
        title = "Practice with paper trading",
        body = "Simulated balances, fees and slippage so you can test the AI's ideas without risking money. " +
            "Every paper order passes the same server-side risk checks as a live one.",
        icon = Icons.Filled.AutoAwesome,
    ),
    OnboardPage(
        title = "Live trading is opt-in",
        body = "Live spot trading is off by default. It requires a separate confirmation, manual approval for " +
            "every order, and API keys stored encrypted on the server — never in the app. " +
            "Futures and leverage are not supported.",
        icon = Icons.Filled.Shield,
    ),
)

@Composable
fun OnboardingScreen(onDone: () -> Unit) {
    val pagerState = rememberPagerState(pageCount = { pages.size })
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(RsColors.Black)
            .padding(24.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            TextButton(onClick = onDone) {
                Text("Skip", color = RsColors.TextMuted)
            }
        }
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(0.dp),
        ) { page ->
            val item = pages[page]
            Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    modifier = Modifier
                        .size(84.dp)
                        .clip(RoundedCornerShape(24.dp))
                        .background(RsColors.Emerald.copy(alpha = 0.12f)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(item.icon, contentDescription = null, tint = RsColors.Emerald, modifier = Modifier.size(38.dp))
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    item.title,
                    style = MaterialTheme.typography.headlineMedium,
                    color = RsColors.TextPrimary,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    item.body,
                    style = MaterialTheme.typography.bodyLarge,
                    color = RsColors.TextSecondary,
                    textAlign = TextAlign.Center,
                )
            }
        }
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
            horizontalArrangement = Arrangement.Center,
        ) {
            repeat(pages.size) { index ->
                Box(
                    Modifier
                        .padding(horizontal = 4.dp)
                        .size(if (index == pagerState.currentPage) 22.dp else 8.dp, 8.dp)
                        .clip(CircleShape)
                        .background(if (index == pagerState.currentPage) RsColors.Emerald else RsColors.Border),
                )
            }
        }
        PrimaryButton(
            text = if (pagerState.currentPage == pages.lastIndex) "Create an account" else "Continue",
            onClick = {
                if (pagerState.currentPage == pages.lastIndex) {
                    onDone()
                } else {
                    scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1) }
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(10.dp))
        Text(
            "By continuing you acknowledge that trading crypto assets carries risk, including total loss of capital.",
            style = MaterialTheme.typography.labelSmall,
            color = RsColors.TextMuted,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}
