#!/data/data/com.termux/files/usr/bin/bash
# One-tap DigiVoX proxy launcher (widget-safe)

PROJECT_DIR="/sdcard/Dev_Lab/DigiVox/Current"
PORT=2345
URL="http://localhost:${PORT}/"
NODE="/data/data/com.termux/files/usr/bin/node"
PID_FILE="${PROJECT_DIR}/digivox_proxy.pid"

# Make sure Termux paths are available (widgets get a minimal env)
export PATH="/data/data/com.termux/files/usr/bin:${PATH}"

cd "$PROJECT_DIR" || exit 1

# ── Kill any stale proxy ─────────────────────────────────────────
echo "🧹 Clearing stale proxy processes..."
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if [ -n "$OLD_PID" ]; then
        kill "$OLD_PID" 2>/dev/null
        sleep 1
        kill -9 "$OLD_PID" 2>/dev/null
    fi
    rm -f "$PID_FILE"
fi
pkill -f "node dl_proxy.js" 2>/dev/null
tmux kill-session -t digivox 2>/dev/null
sleep 1

# Also free the port if something else is holding it
for i in 1 2 3; do
    if curl -s "http://localhost:${PORT}/" > /dev/null 2>&1; then
        echo "⚠️  Port ${PORT} still in use, retrying kill..."
        pkill -9 -f "node dl_proxy.js" 2>/dev/null
        sleep 1
    else
        break
    fi
done

# ── Start the proxy fresh ────────────────────────────────────────
echo "🚀 Starting DigiVoX proxy on port ${PORT}..."
if command -v tmux > /dev/null 2>&1; then
    tmux new-session -d -s digivox "cd \"$PROJECT_DIR\" && exec $NODE dl_proxy.js"
else
    nohup $NODE dl_proxy.js > proxy.log 2>&1 &
    disown
fi

# ── Wait for the NEW server to write its PID file and respond ────
STARTED=false
for i in {1..15}; do
    if [ -f "$PID_FILE" ]; then
        NEW_PID=$(cat "$PID_FILE")
        if [ -n "$NEW_PID" ] && kill -0 "$NEW_PID" 2>/dev/null; then
            if curl -s "http://localhost:${PORT}/" > /dev/null 2>&1; then
                STARTED=true
                echo "✅ Proxy is responding (PID ${NEW_PID})."
                break
            fi
        fi
    fi
    sleep 1
done

if [ "$STARTED" != "true" ]; then
    echo "❌ Proxy failed to start. Check ${PROJECT_DIR}/proxy.log"
    exit 1
fi

# Open the local site in the default browser
echo "🌐 Opening ${URL}"
am start -a android.intent.action.VIEW -d "$URL" > /dev/null 2>&1
