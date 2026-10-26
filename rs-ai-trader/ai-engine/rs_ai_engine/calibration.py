"""Walk-forward training, probability calibration and honest reporting.

The model predicts whether a *cost-adjusted* forward return is positive
(long head) or negative (short head). Calibration is mandatory before the API
is allowed to surface a probability: the signal composer refuses to show a
confidence number for an unvalidated or under-performing model.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    brier_score_loss,
    log_loss,
    roc_auc_score,
)

from .features import FEATURE_COLUMNS, training_rows

log = logging.getLogger(__name__)

MODEL_VERSION = "rsai-gbdt-v1"
MIN_TRAIN_ROWS_FOR_CALIBRATION = 600
MIN_TEST_ROWS = 150

# A model is only trusted to display probabilities if it clears these bars on
# *unseen* data. Thresholds are intentionally conservative.
MIN_AUC = 0.53
MAX_BRIER_VS_BASELINE = 1.0  # must not be worse than predicting the base rate


@dataclass
class HeadMetrics:
    samples: int = 0
    accuracy: float | None = None
    brier: float | None = None
    brier_baseline: float | None = None
    roc_auc: float | None = None
    log_loss: float | None = None
    base_rate: float | None = None
    expected_calibration_error: float | None = None

    @property
    def trusted(self) -> bool:
        if not self.samples or self.roc_auc is None or self.brier is None:
            return False
        if self.brier_baseline is None:
            return False
        return self.roc_auc >= MIN_AUC and self.brier <= self.brier_baseline * MAX_BRIER_VS_BASELINE


@dataclass
class ModelMetrics:
    horizon: int
    cost_bps: float
    train_rows: int
    test_rows: int
    eval_start: str | None
    eval_end: str | None
    long: HeadMetrics = field(default_factory=HeadMetrics)
    short: HeadMetrics = field(default_factory=HeadMetrics)

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["long"]["trusted"] = self.long.trusted
        data["short"]["trusted"] = self.short.trusted
        data["trusted"] = self.long.trusted or self.short.trusted
        return data


def _expected_calibration_error(y: np.ndarray, p: np.ndarray, bins: int = 10) -> float:
    edges = np.linspace(0.0, 1.0, bins + 1)
    total = 0.0
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi if hi < 1.0 else p <= hi)
        if not mask.any():
            continue
        total += mask.mean() * abs(y[mask].mean() - p[mask].mean())
    return float(total)


def _evaluate(y: np.ndarray, p: np.ndarray) -> HeadMetrics:
    if len(y) == 0:
        return HeadMetrics()
    base_rate = float(y.mean())
    constant = np.full_like(p, base_rate, dtype=float)
    metrics = HeadMetrics(
        samples=int(len(y)),
        accuracy=float(accuracy_score(y, (p >= 0.5).astype(int))),
        brier=float(brier_score_loss(y, p)),
        brier_baseline=float(brier_score_loss(y, constant)),
        log_loss=float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1])),
        base_rate=base_rate,
        expected_calibration_error=_expected_calibration_error(y, p),
    )
    if len(np.unique(y)) > 1:
        metrics.roc_auc = float(roc_auc_score(y, p))
    return metrics


def _make_estimator(n_rows: int, positive_rate: float):
    # Small datasets favour a regularised linear model; larger ones get a
    # shallow boosted tree that can capture non-linear indicator interactions.
    if n_rows < 1500 or positive_rate < 0.05:
        return LogisticRegression(max_iter=1000, C=0.5, class_weight="balanced")
    return GradientBoostingClassifier(
        n_estimators=150,
        learning_rate=0.05,
        max_depth=3,
        subsample=0.8,
        min_samples_leaf=25,
        random_state=42,
    )


class CalibratedModel:
    """Container for the two calibrated heads plus their honest metrics."""

    def __init__(
        self,
        long_model: CalibratedClassifierCV | None,
        short_model: CalibratedClassifierCV | None,
        metrics: ModelMetrics,
        *,
        version: str = MODEL_VERSION,
        symbol_scope: str = "*",
        timeframe: str = "1h",
    ) -> None:
        self.long_model = long_model
        self.short_model = short_model
        self.metrics = metrics
        self.version = version
        self.symbol_scope = symbol_scope
        self.timeframe = timeframe
        self.trained_at = datetime.now(timezone.utc).isoformat()

    # -- inference ---------------------------------------------------------
    def _predict(self, model, frame: pd.DataFrame) -> np.ndarray:
        matrix = frame.loc[:, list(FEATURE_COLUMNS)].astype(float)
        if model is None or matrix.isna().any(axis=None):
            return np.full(len(matrix), np.nan)
        return model.predict_proba(matrix)[:, 1]

    def predict_long(self, frame: pd.DataFrame) -> np.ndarray:
        return self._predict(self.long_model, frame)

    def predict_short(self, frame: pd.DataFrame) -> np.ndarray:
        return self._predict(self.short_model, frame)

    @property
    def long_trusted(self) -> bool:
        return self.long_model is not None and self.metrics.long.trusted

    @property
    def short_trusted(self) -> bool:
        return self.short_model is not None and self.metrics.short.trusted

    def recent_performance(self) -> dict[str, Any]:
        return {
            "model_version": self.version,
            "trained_at": self.trained_at,
            "timeframe": self.timeframe,
            "horizon_bars": self.metrics.horizon,
            "cost_bps_assumed": self.metrics.cost_bps,
            "evaluation": {
                "period_start": self.metrics.eval_start,
                "period_end": self.metrics.eval_end,
                "out_of_sample_rows": self.metrics.test_rows,
                "long": asdict(self.metrics.long) | {"trusted": self.long_trusted},
                "short": asdict(self.metrics.short) | {"trusted": self.short_trusted},
            },
            "note": (
                "Out-of-sample metrics are historical estimates on unseen data. "
                "They are not a forecast of future accuracy."
            ),
        }

    # -- persistence -------------------------------------------------------
    def save(self, path: str | Path) -> Path:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(
            {
                "long_model": self.long_model,
                "short_model": self.short_model,
                "metrics": asdict(self.metrics),
                "version": self.version,
                "symbol_scope": self.symbol_scope,
                "timeframe": self.timeframe,
                "trained_at": self.trained_at,
                "trusted_long": self.long_trusted,
                "trusted_short": self.short_trusted,
            },
            path,
        )
        path.with_suffix(".json").write_text(
            json.dumps(self.recent_performance(), indent=2), encoding="utf-8"
        )
        return path


def train_model(
    features: pd.DataFrame,
    *,
    horizon: int = 3,
    cost_bps: float = 20.0,
    test_fraction: float = 0.25,
    symbol_scope: str = "*",
    timeframe: str = "1h",
) -> CalibratedModel:
    """Train on the past, calibrate on a middle slice, evaluate on the future.

    A *purge gap* of ``horizon + 1`` bars is removed between the train and test
    slices so that forward-looking labels cannot overlap the evaluation window.
    """
    rows = training_rows(features)
    rows = rows.sort_index()
    n = len(rows)
    if n < MIN_TRAIN_ROWS_FOR_CALIBRATION:
        raise ValueError(
            f"need >= {MIN_TRAIN_ROWS_FOR_CALIBRATION} complete rows to calibrate, got {n}"
        )
    test_start = int(n * (1 - test_fraction))
    purge = horizon + 1
    train_slice = rows.iloc[: max(0, test_start - purge)]
    test_slice = rows.iloc[test_start:]
    if len(test_slice) < MIN_TEST_ROWS:
        raise ValueError(f"hold-out slice too small ({len(test_slice)} rows)")

    x_train = train_slice.loc[:, list(FEATURE_COLUMNS)].astype(float)
    x_test = test_slice.loc[:, list(FEATURE_COLUMNS)].astype(float)

    metrics = ModelMetrics(
        horizon=horizon,
        cost_bps=cost_bps,
        train_rows=len(train_slice),
        test_rows=len(test_slice),
        eval_start=str(test_slice.index[0]),
        eval_end=str(test_slice.index[-1]),
    )

    def fit_head(label: str, metric_slot: str):
        y_train = train_slice[label].astype(int).to_numpy()
        y_test = test_slice[label].astype(int).to_numpy()
        if len(np.unique(y_train)) < 2 or y_train.mean() < 0.01:
            log.warning("head %s skipped: degenerate labels (rate=%.4f)", label, y_train.mean())
            setattr(metrics, metric_slot, HeadMetrics())
            return None
        estimator = _make_estimator(len(x_train), float(y_train.mean()))
        calibrated = CalibratedClassifierCV(
            estimator,
            method="sigmoid" if len(x_train) < 4000 else "isotonic",
            cv=3,
        )
        calibrated.fit(x_train, y_train)
        probabilities = calibrated.predict_proba(x_test)[:, 1]
        setattr(metrics, metric_slot, _evaluate(y_test, probabilities))
        return calibrated

    long_model = fit_head("y_long", "long")
    short_model = fit_head("y_short", "short")
    return CalibratedModel(
        long_model,
        short_model,
        metrics,
        symbol_scope=symbol_scope,
        timeframe=timeframe,
    )


def load_model(path: str | Path) -> CalibratedModel | None:
    path = Path(path)
    if not path.exists():
        return None
    try:
        payload = joblib.load(path)
        raw_metrics = payload["metrics"]
        metrics = ModelMetrics(
            horizon=raw_metrics["horizon"],
            cost_bps=raw_metrics["cost_bps"],
            train_rows=raw_metrics["train_rows"],
            test_rows=raw_metrics["test_rows"],
            eval_start=raw_metrics.get("eval_start"),
            eval_end=raw_metrics.get("eval_end"),
            long=HeadMetrics(**raw_metrics["long"]),
            short=HeadMetrics(**raw_metrics["short"]),
        )
        model = CalibratedModel(
            payload.get("long_model"),
            payload.get("short_model"),
            metrics,
            version=payload.get("version", MODEL_VERSION),
            symbol_scope=payload.get("symbol_scope", "*"),
            timeframe=payload.get("timeframe", "1h"),
        )
        # Preserve the recorded training timestamp instead of "now".
        model.trained_at = payload.get("trained_at", model.trained_at)
        return model
    except Exception:  # pragma: no cover - corrupt artefact
        log.exception("failed to load model artefact at %s", path)
        return None


def save_model(model: CalibratedModel, path: str | Path) -> Path:
    return model.save(path)
