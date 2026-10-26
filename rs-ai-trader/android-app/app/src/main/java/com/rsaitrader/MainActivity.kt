package com.rsaitrader

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.rsaitrader.ui.RsAiTraderRoot
import com.rsaitrader.ui.theme.RsAiTraderTheme

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            RsAiTraderTheme {
                RsAiTraderRoot()
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Do not keep a market socket open while the app is backgrounded; the
        // ViewModels restart the feed when a screen is shown again.
        com.rsaitrader.di.ServiceLocator.feed.pause()
    }
}
