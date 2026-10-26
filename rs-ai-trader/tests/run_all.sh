#!/usr/bin/env bash
# Run every headless test suite. Exits non-zero on the first failure.
#
#   ./tests/run_all.sh
#
# Optional: export RSAI_TEST_DATABASE_URL to include the PostgreSQL integration
# test, e.g.
#   RSAI_TEST_DATABASE_URL="postgresql+psycopg://postgres@localhost/rsai_test" ./tests/run_all.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"

echo "== backend tests =="
(cd "$ROOT/backend" && "$PYTHON" -m pytest tests -q)

echo
echo "== ai-engine tests =="
(cd "$ROOT/ai-engine" && "$PYTHON" -m pytest tests -q)

if [[ -n "${RSAI_TEST_DATABASE_URL:-}" ]]; then
  echo
  echo "== postgres integration test =="
  (cd "$ROOT/backend" && "$PYTHON" -m pytest tests/test_postgres_integration.py -q)
else
  echo
  echo "-- skipping PostgreSQL integration test (RSAI_TEST_DATABASE_URL not set)"
fi

if command -v java >/dev/null 2>&1 && [[ -x "$ROOT/android-app/gradlew" ]]; then
  echo
  echo "== android unit tests =="
  (cd "$ROOT/android-app" && ./gradlew :app:testDebugUnitTest --console=plain)
else
  echo "-- skipping Android unit tests (no JDK or no gradle wrapper)"
fi

echo
echo "All available suites passed."
