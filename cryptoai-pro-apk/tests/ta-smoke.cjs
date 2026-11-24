const assert = require('assert');
global.Patterns = require('../app/src/patterns.js');
const TA = require('../app/src/ta.js');
const Brain = require('../app/src/brain.js');
let seed = 1717;
function rnd() { seed = (seed * 48271) % 2147483647; return seed / 2147483647; }
const candles = [];
let px = 100;
for (let i = 0; i < 700; i++) {
  const open = px;
  px *= 1 + 0.00008 + (rnd() - 0.49) * 0.009;
  candles.push({ t: i * 300000, o: open, h: Math.max(open, px) * (1 + rnd() * 0.003), l: Math.min(open, px) * (1 - rnd() * 0.003), c: px, v: 1000 + rnd() * 800 });
}
assert.equal(TA.analyze(candles.slice(0, 59)).ok, false);
const report = TA.analyze(candles);
assert.equal(report.ok, true);
assert(Number.isFinite(report.score) && report.score >= -1 && report.score <= 1);
assert(report.confidence >= 4 && report.confidence <= 97);
if (report.levels) assert(report.levels.sl > 0 && report.levels.tp > 0);
const bt = TA.backtest(candles, { riskPct: 1 });
assert(bt.trades >= 0 && Number.isFinite(bt.pnlPct) && Number.isFinite(bt.maxDD));
const train = Brain.trainHistory(candles, { epochs: 2 });
assert.equal(train.ok, true);
assert(Number.isFinite(train.testAcc) && Number.isFinite(train.brier));
const flat = Array.from({length: 180}, (_, i) => ({t:i*60000,o:100,h:101,l:99,c:100,v:100}));
const flatReport = TA.analyze(flat);
assert.equal(flatReport.ok, true);
assert.equal(flatReport.verdict, 'NEUTRAL');
assert.equal(flatReport.metrics.rsi, 50);
assert(Number.isFinite(flatReport.score));
console.log(JSON.stringify({ta:TA.version, brain:Brain.version, verdict:report.verdict, score:report.score, backtest:{trades:bt.trades,pnlPct:bt.pnlPct,maxDD:bt.maxDD}, training:{samples:train.samples,testAcc:train.testAcc,brier:train.brier}, flat:flatReport.verdict}, null, 2));
