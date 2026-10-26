"""RS AI TRADER analysis engine.

Pure-Python/pandas research package used by the FastAPI backend. It contains
indicators, a leakage-free feature builder, a walk-forward calibrated model,
the signal composer, a cost-aware backtester and a grounded bilingual
assistant. Nothing in this package places orders or talks to Binance.
"""
from .signals import SignalConfig, SignalResult, generate_signal
from .indicators import compute_indicator_snapshot
from .backtest import BacktestConfig, BacktestResult, run_backtest
from .features import build_features, FEATURE_COLUMNS
from .calibration import CalibratedModel, load_model, save_model
from .regime import classify_regime

__all__ = [
    "SignalConfig",
    "SignalResult",
    "generate_signal",
    "compute_indicator_snapshot",
    "BacktestConfig",
    "BacktestResult",
    "run_backtest",
    "build_features",
    "FEATURE_COLUMNS",
    "CalibratedModel",
    "load_model",
    "save_model",
    "classify_regime",
]

__version__ = "1.0.0"
MODEL_VERSION = "rsai-composite-v1"
