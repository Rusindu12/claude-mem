// Run with: node tests/model-smoke.cjs
// Checks the bundled model's dimensions and numerical behaviour; not a profitability test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app/src/main/assets/model.js'), 'utf8'), sandbox);
const m = sandbox.window.NEURAL_MODEL;
assert.equal(m.mean.length, 8);
assert.equal(m.scale.length, 8);
assert.equal(m.weights[0].length, 8);
assert.equal(m.biases[0].length, 8);
assert.ok(m.scale.every(x => Number.isFinite(x) && x > 0));
function predict(x) {
  const n = x.map((v, i) => (v - m.mean[i]) / m.scale[i]);
  const h = m.biases[0].map((b, j) => Math.max(0, b + n.reduce((s, v, i) => s + v * m.weights[0][i][j], 0)));
  const z = m.biases[1][0] + h.reduce((s, v, i) => s + v * m.weights[1][i][0], 0);
  return 1 / (1 + Math.exp(-Math.max(-40, Math.min(40, z))));
}
for (const x of [Array(8).fill(0), m.mean, Array(8).fill(0.01), Array(8).fill(-0.01)]) {
  const p = predict(x);
  assert.ok(Number.isFinite(p) && p >= 0 && p <= 1);
}
assert.ok(m.metrics.test.accuracy < m.metrics.test.majority_baseline, 'Do not silently misstate the recorded test result');
console.log('Model smoke checks passed. This does not validate profitability.');
