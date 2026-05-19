#!/bin/bash
# E2E tests for peaks CLI config workflow

PEAKS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
PEAKS="$PEAKS_DIR/bin/peaks.js"
WORKSPACE_ID="test-e2e-ws"
WORKSPACE_NAME="Test E2E Workspace"
WORKSPACE_PATH="/tmp/test-e2e-peaks"

FAILED=0

run_test() {
    local name="$1"
    local cmd="$2"
    echo -n "Testing $name... "
    if eval "$cmd" > /dev/null 2>&1; then
        echo "PASS"
    else
        echo "FAIL"
        FAILED=$((FAILED + 1))
    fi
}

echo "=== Testing peaks CLI config workflow ==="

run_test "config workspace list" "$PEAKS config workspace list --json"
run_test "config get" "$PEAKS config get --json"
run_test "config set" "$PEAKS config set --key testKey --value '\"testValue\"' --json"
run_test "config workspace add" "$PEAKS config workspace add --id $WORKSPACE_ID --name '$WORKSPACE_NAME' --path $WORKSPACE_PATH --json"
run_test "config workspace switch" "$PEAKS config workspace switch --id $WORKSPACE_ID --json"
run_test "config workspace remove" "$PEAKS config workspace remove --id $WORKSPACE_ID --json"

# These should fail
run_test "config workspace switch unknown (should fail)" "! $PEAKS config workspace switch --id nonexistent --json"

echo ""
if [ $FAILED -eq 0 ]; then
    echo "=== All config workflow tests passed ==="
    exit 0
else
    echo "=== $FAILED tests failed ==="
    exit 1
fi