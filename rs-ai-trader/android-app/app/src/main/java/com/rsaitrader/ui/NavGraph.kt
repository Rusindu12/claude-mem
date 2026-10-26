package com.rsaitrader.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CandlestickChart
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PieChart
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.rsaitrader.di.ServiceLocator
import com.rsaitrader.ui.screens.AdminScreen
import com.rsaitrader.ui.screens.AlertsScreen
import com.rsaitrader.ui.screens.AnalyticsScreen
import com.rsaitrader.ui.screens.ApiSettingsScreen
import com.rsaitrader.ui.screens.AssistantScreen
import com.rsaitrader.ui.screens.AuthScreen
import com.rsaitrader.ui.screens.BacktestScreen
import com.rsaitrader.ui.screens.ChartScreen
import com.rsaitrader.ui.screens.DashboardScreen
import com.rsaitrader.ui.screens.OnboardingScreen
import com.rsaitrader.ui.screens.OrdersScreen
import com.rsaitrader.ui.screens.PortfolioScreen
import com.rsaitrader.ui.screens.RiskScreen
import com.rsaitrader.ui.screens.SecurityScreen
import com.rsaitrader.ui.screens.SettingsScreen
import com.rsaitrader.ui.screens.SignalsScreen
import com.rsaitrader.ui.screens.SplashScreen
import com.rsaitrader.ui.screens.TerminalScreen
import com.rsaitrader.ui.screens.WatchlistScreen
import com.rsaitrader.ui.theme.RsColors
import com.rsaitrader.ui.viewmodel.AdminViewModel
import com.rsaitrader.ui.viewmodel.AlertsViewModel
import com.rsaitrader.ui.viewmodel.AnalyticsViewModel
import com.rsaitrader.ui.viewmodel.ApiSettingsViewModel
import com.rsaitrader.ui.viewmodel.AppSettingsViewModel
import com.rsaitrader.ui.viewmodel.AssistantViewModel
import com.rsaitrader.ui.viewmodel.AuthState
import com.rsaitrader.ui.viewmodel.AuthViewModel
import com.rsaitrader.ui.viewmodel.BacktestViewModel
import com.rsaitrader.ui.viewmodel.ChartViewModel
import com.rsaitrader.ui.viewmodel.DashboardViewModel
import com.rsaitrader.ui.viewmodel.OrdersViewModel
import com.rsaitrader.ui.viewmodel.PortfolioViewModel
import com.rsaitrader.ui.viewmodel.RiskViewModel
import com.rsaitrader.ui.viewmodel.SecurityViewModel
import com.rsaitrader.ui.viewmodel.SignalsViewModel
import com.rsaitrader.ui.viewmodel.TerminalViewModel
import com.rsaitrader.ui.viewmodel.WatchlistViewModel

object Routes {
    const val DASHBOARD = "dashboard"
    const val MARKETS = "markets"
    const val TERMINAL = "terminal"
    const val PORTFOLIO = "portfolio"
    const val SETTINGS = "settings"
    const val CHART = "chart/{symbol}"
    const val SIGNALS = "signals"
    const val ORDERS = "orders"
    const val ANALYTICS = "analytics"
    const val BACKTEST = "backtest"
    const val RISK = "risk"
    const val ALERTS = "alerts"
    const val ASSISTANT = "assistant"
    const val API_SETTINGS = "apiSettings"
    const val SECURITY = "security"
    const val ADMIN = "admin"

    fun chart(symbol: String) = "chart/$symbol"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab(Routes.DASHBOARD, "Dashboard", Icons.Filled.GridView),
    Tab(Routes.MARKETS, "Markets", Icons.Filled.CandlestickChart),
    Tab(Routes.TERMINAL, "Trade", Icons.Filled.SwapVert),
    Tab(Routes.PORTFOLIO, "Portfolio", Icons.Filled.PieChart),
    Tab(Routes.SETTINGS, "More", Icons.Filled.MoreHoriz),
)

/** Root composable: decides onboarding → auth → main shell. */
@Composable
fun RsAiTraderRoot() {
    val authViewModel: AuthViewModel = viewModel()
    val authState by authViewModel.authState.collectAsStateWithLifecycle()
    val favorites = remember { ServiceLocator.favorites }
    var onboardingDone by remember { mutableStateOf(favorites.onboardingDone()) }

    LaunchedEffect(authState) {
        if (authState is AuthState.SignedOut) ServiceLocator.feed.stop()
    }

    when (val state = authState) {
        AuthState.Booting -> {
            if (onboardingDone) SplashScreen() else OnboardingScreen {
                favorites.setOnboardingDone(true)
                onboardingDone = true
            }
        }
        AuthState.SignedOut -> {
            if (onboardingDone) {
                AuthScreen(authViewModel)
            } else {
                OnboardingScreen {
                    favorites.setOnboardingDone(true)
                    onboardingDone = true
                }
            }
        }
        is AuthState.SignedIn -> AppShell(
            user = state.user,
            authViewModel = authViewModel,
        )
    }
}

@Composable
private fun AppShell(user: com.rsaitrader.core.network.UserDto, authViewModel: AuthViewModel) {
    val navController = rememberNavController()
    val backStack by navController.currentBackStackEntryAsState()
    val currentRoute = backStack?.destination?.route
    val showBottomBar = tabs.any { it.route == currentRoute }

    LifecycleEventEffect(Lifecycle.Event.ON_START) { ServiceLocator.feed.resume() }

    Scaffold(
        containerColor = RsColors.Black,
        bottomBar = {
            if (showBottomBar) {
                NavigationBar(containerColor = RsColors.Navy, tonalElevation = 0.dp) {
                    tabs.forEach { tab ->
                        NavigationBarItem(
                            selected = currentRoute == tab.route,
                            onClick = {
                                if (currentRoute != tab.route) {
                                    navController.navigate(tab.route) {
                                        popUpTo(Routes.DASHBOARD) { saveState = true }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                }
                            },
                            icon = { Icon(tab.icon, contentDescription = tab.label) },
                            label = {
                                Text(tab.label, style = androidx.compose.material3.MaterialTheme.typography.labelSmall)
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = RsColors.Emerald,
                                selectedTextColor = RsColors.Emerald,
                                unselectedIconColor = RsColors.TextMuted,
                                unselectedTextColor = RsColors.TextMuted,
                                indicatorColor = RsColors.Emerald.copy(alpha = 0.12f),
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            RsAiTraderNavHost(navController = navController, user = user, authViewModel = authViewModel)
        }
    }
}

@Composable
private fun RsAiTraderNavHost(
    navController: NavHostController,
    user: com.rsaitrader.core.network.UserDto,
    authViewModel: AuthViewModel,
) {
    val symbols = remember {
        (ServiceLocator.favorites.favorites() + listOf("BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"))
            .distinct()
    }
    NavHost(navController = navController, startDestination = Routes.DASHBOARD) {

        composable(Routes.DASHBOARD) {
            val vm: DashboardViewModel = viewModel()
            DashboardScreen(
                viewModel = vm,
                userName = user.displayName,
                onOpenChart = { symbol -> navController.navigate(Routes.chart(symbol)) },
                onOpenTerminal = { navController.navigate(Routes.TERMINAL) },
                onNavigate = { route -> navController.navigate(route) },
            )
        }

        composable(Routes.MARKETS) {
            val vm: WatchlistViewModel = viewModel()
            WatchlistScreen(vm) { symbol -> navController.navigate(Routes.chart(symbol)) }
        }

        composable(
            route = Routes.CHART,
            arguments = listOf(navArgument("symbol") { type = NavType.StringType }),
        ) { entry ->
            val symbol = entry.arguments?.getString("symbol") ?: "BTCUSDT"
            val vm: ChartViewModel = viewModel()
            LaunchedEffect(symbol) { vm.setSymbol(symbol) }
            ChartScreen(
                viewModel = vm,
                symbols = symbols,
                onBack = { navController.popBackStack() },
                onTrade = { selected ->
                    ServiceLocator.favorites.setLastSymbol(selected)
                    navController.navigate(Routes.TERMINAL)
                },
            )
        }

        composable(Routes.SIGNALS) {
            val vm: SignalsViewModel = viewModel()
            SignalsScreen(
                viewModel = vm,
                symbols = symbols,
                onBack = { navController.popBackStack() },
                onTrade = { symbol, _ ->
                    ServiceLocator.favorites.setLastSymbol(symbol)
                    navController.navigate(Routes.TERMINAL)
                },
            )
        }

        composable(Routes.TERMINAL) {
            val vm: TerminalViewModel = viewModel()
            TerminalScreen(
                viewModel = vm,
                symbols = symbols,
                onOpenOrders = { navController.navigate(Routes.ORDERS) },
            )
        }

        composable(Routes.ORDERS) {
            val vm: OrdersViewModel = viewModel()
            OrdersScreen(vm) { navController.popBackStack() }
        }

        composable(Routes.PORTFOLIO) {
            val vm: PortfolioViewModel = viewModel()
            PortfolioScreen(
                viewModel = vm,
                onBack = { navController.navigate(Routes.DASHBOARD) },
                onOpenAnalytics = { navController.navigate(Routes.ANALYTICS) },
            )
        }

        composable(Routes.ANALYTICS) {
            val vm: AnalyticsViewModel = viewModel()
            AnalyticsScreen(vm) { navController.popBackStack() }
        }

        composable(Routes.BACKTEST) {
            val vm: BacktestViewModel = viewModel()
            BacktestScreen(vm, symbols) { navController.popBackStack() }
        }

        composable(Routes.RISK) {
            val vm: RiskViewModel = viewModel()
            RiskScreen(vm) { navController.popBackStack() }
        }

        composable(Routes.ALERTS) {
            val vm: AlertsViewModel = viewModel()
            AlertsScreen(vm, symbols) { navController.popBackStack() }
        }

        composable(Routes.ASSISTANT) {
            val vm: AssistantViewModel = viewModel()
            AssistantScreen(vm) { navController.popBackStack() }
        }

        composable(Routes.API_SETTINGS) {
            val vm: ApiSettingsViewModel = viewModel()
            ApiSettingsScreen(vm) { navController.popBackStack() }
        }

        composable(Routes.SECURITY) {
            val vm: SecurityViewModel = viewModel()
            SecurityScreen(vm, authViewModel) { navController.popBackStack() }
        }

        composable(Routes.SETTINGS) {
            val vm: AppSettingsViewModel = viewModel()
            SettingsScreen(
                viewModel = vm,
                isAdmin = user.role == "admin",
                onNavigate = { route -> navController.navigate(route) },
                onLogout = { authViewModel.logout() },
            )
        }

        composable(Routes.ADMIN) {
            val vm: AdminViewModel = viewModel()
            AdminScreen(vm) { navController.popBackStack() }
        }
    }
}
