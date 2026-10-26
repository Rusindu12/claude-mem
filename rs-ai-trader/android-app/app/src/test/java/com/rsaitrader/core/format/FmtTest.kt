package com.rsaitrader.core.format

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Pure formatting tests — no Android framework involved.
 *
 * NOTE: these were written but could not be executed while the project was
 * generated (no JDK in the build environment). Run them with:
 *
 *   cd android-app && ./gradlew :app:testDebugUnitTest
 */
class FmtTest {

    @Test
    fun `prices keep useful precision`() {
        assertEquals("64000.00", Fmt.price("64000"))
        assertEquals("1.2346", Fmt.price("1.23456"))
        assertEquals("0.00001235", Fmt.price("0.000012345"))
        assertEquals("—", Fmt.price(null as String?))
    }

    @Test
    fun `usdt amounts always show two decimals`() {
        assertEquals("$12.35", Fmt.usdt("12.345"))
        assertEquals("-$1.50", Fmt.usdtSigned("-1.5"))
        assertEquals("+$0.00", Fmt.usdtSigned("0"))
    }

    @Test
    fun `percent formatting never invents precision`() {
        assertEquals("12.35%", Fmt.percent("12.345"))
        assertEquals("—", Fmt.percent(null as String?))
        assertEquals("+2.50%", Fmt.signedPercent(2.5))
        assertEquals("-2.50%", Fmt.signedPercent(-2.5))
    }

    @Test
    fun `quantities are trimmed without losing value`() {
        assertEquals("0.001", Fmt.amount("0.001000"))
        assertEquals("100", Fmt.amount("100.00"))
    }

    @Test
    fun `symbol helpers`() {
        assertEquals("BTC / USDT", Fmt.pair("BTCUSDT"))
        assertEquals("BTC", Fmt.base("BTCUSDT"))
        assertEquals("ETH / BTC", Fmt.pair("ETHBTC"))
        assertEquals("PAPER", Fmt.modeLabel("paper"))
        assertEquals("LIVE SPOT", Fmt.modeLabel("live"))
    }

    @Test
    fun `volume is abbreviated`() {
        assertEquals("1.50M", Fmt.compactVolume(1_500_000.0))
        assertEquals("2.0K", Fmt.compactVolume(2_000.0))
    }

    @Test
    fun `user input parsing is tolerant`() {
        assertNull("abc".toDecimalOrNull())
        assertEquals("12.5".toBigDecimalOrNull(), " 12.5 ".toDecimalOrNull())
    }
}
