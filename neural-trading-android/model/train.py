#!/usr/bin/env python3
"""Research prototype, NOT a trading strategy. Input: 15m Binance CSV files.
Train on complete 1h bars and evaluate chronologically on the last 15% of each pair.
"""
import argparse, hashlib, json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, log_loss

PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']

def samples(path):
    data = pd.read_csv(path, parse_dates=['open_time']).set_index('open_time').sort_index()
    if data.index.has_duplicates: raise ValueError(f'duplicate timestamps: {path}')
    if not ((data.index.minute % 15 == 0) & (data.index.second == 0) & (data.index.microsecond == 0)).all():
        raise ValueError(f'input must be aligned 15-minute candles: {path}')
    bars = data.resample('1h').agg(close=('close', 'last'), count=('close', 'size'))
    bars = bars[bars['count'] == 4]
    rows = []
    for i in range(8, len(bars)-1):
        subset = bars.iloc[i-8:i+2]
        if not (subset.index.to_series().diff().dropna() == pd.Timedelta(hours=1)).all(): continue
        c = subset.close.to_numpy(dtype=float)
        if not np.all(np.isfinite(c)) or not np.all(c > 0): continue
        x = np.log(c[1:9] / c[:8])
        rows.append((bars.index[i], x, int(c[9] > c[8]), float(c[9] / c[8] - 1)))
    return rows

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('data', type=Path, help='Directory containing SYMBOL_15m_30d.csv files')
    parser.add_argument('--output', type=Path, default=Path('../app/src/main/assets/model.js'))
    args = parser.parse_args()
    splits = [[], [], []]; sources = {}; test_by_pair = {}
    for pair in PAIRS:
        path = args.data / f'{pair}_15m_30d.csv'
        rows = samples(path)
        if len(rows) < 100: raise ValueError(f'not enough samples for {pair}')
        n = len(rows); a = int(n*.70); b = int(n*.85)
        # Exclude the final training/validation sample so its target cannot cross a split boundary.
        for group, part in zip(splits, [rows[:a-1], rows[a:b-1], rows[b:]]): group.extend(part)
        test_by_pair[pair] = rows[b:]
        sources[pair] = {'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'first': str(rows[0][0]), 'last': str(rows[-1][0]), 'samples': n}
    def unpack(rows): return np.array([r[1] for r in rows]), np.array([r[2] for r in rows])
    x, y = unpack(splits[0]); scaler = StandardScaler().fit(x)
    model = MLPClassifier(hidden_layer_sizes=(8,), activation='relu', random_state=42, max_iter=1000, alpha=1.0, early_stopping=False)
    model.fit(scaler.transform(x), y)
    metrics = {}
    for label, rows in zip(['train', 'validation', 'test'], splits):
        xx, yy = unpack(rows); p = model.predict_proba(scaler.transform(xx))[:, 1]
        metrics[label] = {'n': len(yy), 'accuracy': round(float(accuracy_score(yy, p >= .5)), 4), 'majority_baseline': round(float(max(yy.mean(), 1-yy.mean())), 4), 'log_loss': round(float(log_loss(yy, p)), 4)}
    # Simplified close-to-close long/flat experiment, not the paper bot's TP/SL.
    # Assumes frictionless fills at the signal close and charges 0.1% per turnover.
    backtest = {}
    for pair, rows in test_by_pair.items():
        xx, _ = unpack(rows)
        probabilities = model.predict_proba(scaler.transform(xx))[:, 1]
        equity = 1.0; position = 0; turns = 0; previous = None
        for row, prob in zip(rows, probabilities):
            if previous is not None and row[0] - previous != pd.Timedelta(hours=1) and position:
                equity *= .999; turns += 1; position = 0
            previous = row[0]
            desired = int(prob >= .5)
            turns += abs(desired - position)
            equity *= (1 - .001 * abs(desired - position)) * (1 + desired * row[3])
            position = desired
        if position: equity *= .999; turns += 1
        backtest[pair] = {'hours': len(rows), 'turnovers': turns, 'return_pct': round((equity - 1) * 100, 2)}
    out = {'illustrative_backtest': backtest, 'features': 'eight consecutive hourly log close returns, oldest first', 'target': 'next hourly close greater than current hourly close', 'sources': sources, 'metrics': metrics, 'mean': scaler.mean_.tolist(), 'scale': scaler.scale_.tolist(), 'weights': [w.tolist() for w in model.coefs_], 'biases': [b.tolist() for b in model.intercepts_]}
    args.output.write_text('window.NEURAL_MODEL = ' + json.dumps(out, separators=(',', ':')) + ';\n')
    print(json.dumps({"classification": metrics, "illustrative_backtest": backtest}, indent=2))
if __name__ == '__main__': main()
