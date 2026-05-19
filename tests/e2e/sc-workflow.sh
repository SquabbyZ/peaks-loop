#!/bin/bash
# E2E tests for peaks CLI sc (source control / change traceability) workflow

PEAKS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PEAKS="$PEAKS_DIR/bin/peaks.js"

FAILED=0

run_test() {
    local name="$1"
    shift
    echo -n "Testing $name... "
    if "$@" > /dev/null 2>&1; then
        echo "PASS"
    else
        echo "FAIL"
        FAILED=$((FAILED + 1))
    fi
}

run_fail_test() {
    local name="$1"
    shift
    echo -n "Testing $name... "
    if "$@" > /dev/null 2>&1; then
        echo "FAIL"
        FAILED=$((FAILED + 1))
    else
        echo "PASS"
    fi
}

echo "=== Testing peaks CLI sc workflow ==="

run_test "sc status" "$PEAKS" sc status --json
run_test "sc help" "$PEAKS" sc help --json
run_test "sc impact" "$PEAKS" sc impact --change-id test-change --module module1 --file file1.ts --json
run_test "sc retention" "$PEAKS" sc retention --slice-id slice-1 --prd prd.md --rd rd.md --qa qa.md --json
run_test "sc validate" "$PEAKS" sc validate --slice-id slice-1 --json
run_test "sc boundary" "$PEAKS" sc boundary --slice-id slice-1 --artifact a1.md --code src/test.ts --json
run_test "sc impact handles repo metadata" "$PEAKS" sc impact --change-id test-change --json
run_test "sc status with no current change" "$PEAKS" sc status --json

run_fail_test "sc impact reject missing change-id (should fail)" "$PEAKS" sc impact --json
run_fail_test "sc retention reject missing slice-id (should fail)" "$PEAKS" sc retention --json

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== All sc workflow tests passed ==="
    exit 0
else
    echo "=== $FAILED tests failed ==="
    exit 1
fi
