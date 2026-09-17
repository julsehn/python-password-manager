#!/bin/bash
# ============================================================================
# Caixa Forta - Native Messaging Diagnostic Script
# This script tests the native messaging connection and captures detailed logs
# ============================================================================

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_SCRIPT="$PROJECT_DIR/browser-extension/native/caixa_forta_native.py"
LOG_FILE="/tmp/caixa_forta_diagnostic_$(date +%Y%m%d_%H%M%S).log"

echo "========================================"
echo "  Caixa Forta - Native Messaging Diagnostic"
echo "========================================"
echo ""

# Check if host script exists
if [[ ! -f "$HOST_SCRIPT" ]]; then
    echo "ERROR: Host script not found: $HOST_SCRIPT"
    exit 1
fi

# Create log file
echo "Diagnostic started at: $(date)" > "$LOG_FILE"
echo "Project directory: $PROJECT_DIR" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Stop any existing host
log "Stopping any existing native messaging host..."
pkill -f "caixa_forta_native.py" 2>/dev/null || true
sleep 1

# Start the host in the foreground with debug logging
log "Starting native messaging host with debug logging..."
log "Host script: $HOST_SCRIPT"

# Start the host and capture output
python3 "$HOST_SCRIPT" --debug 2>&1 | tee -a "$LOG_FILE" &
HOST_PID=$!

log "Host started with PID: $HOST_PID"
log "Waiting 5 seconds for host to initialize..."
sleep 5

# Check if host is still running
if ! kill -0 $HOST_PID 2>/dev/null; then
    log "ERROR: Host failed to start (PID $HOST_PID)"
    log "Log file: $LOG_FILE"
    exit 1
fi

log "Host is running (PID: $HOST_PID)"
log ""
log "========================================"
log "  Testing Native Messaging Connection"
log "========================================"
log ""

# Test 1: Send a ping message (Native Messaging API format)
log "Test 1: Sending ping message (Native Messaging API format)..."
PING_DATA=$(printf '\x00\x00\x00\x05{"action":"ping"}')
echo -n "$PING_DATA" | python3 -c "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())" | python3 "$HOST_SCRIPT" 2>&1 | tee -a "$LOG_FILE"

sleep 1

# Test 2: Send getVaultInfo message
log ""
log "Test 2: Sending getVaultInfo message..."
echo '{"action":"getVaultInfo"}' | python3 "$HOST_SCRIPT" 2>&1 | tee -a "$LOG_FILE"

sleep 1

# Test 3: Send generatePassword message
log ""
log "Test 3: Sending generatePassword message..."
echo '{"action":"generatePassword","options":{"length":16}}' | python3 "$HOST_SCRIPT" 2>&1 | tee -a "$LOG_FILE"

sleep 1

# Test 4: Check host process
log ""
log "Test 4: Checking host process..."
if ps -p $HOST_PID > /dev/null 2>&1; then
    log "Host process is running (PID: $HOST_PID)"
    ps -p $HOST_PID -o pid,ppid,cmd --no-headers | tee -a "$LOG_FILE"
else
    log "ERROR: Host process is not running!"
fi

# Stop the host
log ""
log "Stopping host..."
kill $HOST_PID 2>/dev/null || true
wait $HOST_PID 2>/dev/null || true

log ""
log "========================================"
log "  Diagnostic Complete"
log "========================================"
log ""
log "Log file saved to: $LOG_FILE"
log ""
log "Please review the log file for any errors."
log "If you see 'Incomplete length header received' errors,"
log "it means Firefox is trying to connect before the host is ready."
log ""

echo ""
echo "Diagnostic complete. Log file: $LOG_FILE"
echo "Please review the log for any errors."
