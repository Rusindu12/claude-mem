package com.rsaitrader.ui.theme

import android.app.Activity
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

/**
 * RS AI TRADER palette: near-black canvas, deep navy surfaces, emerald accent.
 * The app is dark-only by product decision (trading screens at night).
 */
object RsColors {
    val Black = Color(0xFF05070C)
    val Navy = Color(0xFF0B1424)
    val NavyLight = Color(0xFF111D33)
    val Surface = Color(0xFF0E1830)
    val SurfaceHigh = Color(0xFF16233D)
    val Border = Color(0xFF1E2E4A)

    val Emerald = Color(0xFF10B981)
    val EmeraldDim = Color(0xFF0B8A61)
    val EmeraldGlow = Color(0xFF34D399)

    val Danger = Color(0xFFEF4444)
    val Warning = Color(0xFFF59E0B)
    val Info = Color(0xFF38BDF8)
    val Violet = Color(0xFF8B5CF6)

    val TextPrimary = Color(0xFFE8EEF7)
    val TextSecondary = Color(0xFF9AA9C0)
    val TextMuted = Color(0xFF6B7C96)
}

private val RsDarkScheme = darkColorScheme(
    primary = RsColors.Emerald,
    onPrimary = Color(0xFF04180F),
    primaryContainer = RsColors.EmeraldDim,
    onPrimaryContainer = RsColors.TextPrimary,
    secondary = RsColors.Info,
    onSecondary = RsColors.Black,
    tertiary = RsColors.Violet,
    background = RsColors.Black,
    onBackground = RsColors.TextPrimary,
    surface = RsColors.Navy,
    onSurface = RsColors.TextPrimary,
    surfaceVariant = RsColors.NavyLight,
    onSurfaceVariant = RsColors.TextSecondary,
    surfaceContainer = RsColors.Surface,
    surfaceContainerHigh = RsColors.SurfaceHigh,
    outline = RsColors.Border,
    outlineVariant = RsColors.Border,
    error = RsColors.Danger,
    onError = Color.White,
    errorContainer = Color(0xFF3B1214),
    onErrorContainer = Color(0xFFFCA5A5),
)

private val RsTypography = Typography(
    displaySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 30.sp,
        letterSpacing = (-0.5).sp,
    ),
    headlineMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.Bold,
        fontSize = 24.sp,
    ),
    headlineSmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 20.sp,
    ),
    titleLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 18.sp,
    ),
    titleMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 15.sp,
    ),
    bodyLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 15.sp,
        lineHeight = 22.sp,
    ),
    bodyMedium = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 13.5.sp,
        lineHeight = 20.sp,
    ),
    bodySmall = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontSize = 12.sp,
        lineHeight = 17.sp,
    ),
    labelLarge = TextStyle(
        fontFamily = FontFamily.SansSerif,
        fontWeight = FontWeight.SemiBold,
        fontSize = 13.sp,
        letterSpacing = 0.2.sp,
    ),
    labelSmall = TextStyle(
        fontFamily = FontFamily.Monospace,
        fontSize = 10.5.sp,
        letterSpacing = 0.4.sp,
    ),
)

/** Monospaced style for prices and quantities so digits align. */
val MonoStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 13.sp,
    fontWeight = FontWeight.Medium,
)

val MonoSmallStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontSize = 11.5.sp,
)

val ScreenPadding = 16.dp
val CardRadius = 18.dp

@Composable
fun RsAiTraderTheme(content: @Composable () -> Unit) {
    // Dark theme is intentional; ignore the system setting so charts keep contrast.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(
        colorScheme = RsDarkScheme,
        typography = RsTypography,
        content = content,
    )
}
