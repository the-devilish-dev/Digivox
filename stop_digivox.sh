#!/data/data/com.termux/files/usr/bin/bash
# Stop the DigiVoX proxy

PROJECT_DIR="/sdcard/Dev_Lab/DigiVox/Current"
PID_FILE="${PROJECT_DIR}/digivox_proxy.pid"

echo "🧹 Stopping DigiVoX proxy..."

# Kill the tracked PID first
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    rm -f "$PID_FILE"
    if [ -n "$PID" ]; then
        echo "🛑 Killing tracked PID: $PID"
        kill "$PID" 2>/dev/null
        sleep 1
        kill -9 "$PID" 2>/dev/null
    fi
fi

# Fallback process cleanup
pkill -f "node dl_proxy.js" 2>/dev/null
tmux kill-session -t digivox 2>/dev/null
sleep 1

# Ensure port is free
if curl -s "http://localhost:2345/" > /dev/null 2>&1; then
    echo "⚠️  Port 2345 still in use; force-killing all matching node processes..."
    pkill -9 -f "node dl_proxy.js" 2>/dev/null
    sleep 1
fi

if curl -s "http://localhost:2345/" > /dev/null 2>&1; then
    echo "❌ Port 2345 is still occupied by another process. Rebooting Termux may clear it."
    exit 1
fi

echo "✅ Proxy stopped and port 2345 is free."
