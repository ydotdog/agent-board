#!/bin/bash
# Start Claude Bridge + SSH reverse tunnel to VPS
# Run this on your Mac to enable AI comments on ab.y.dog

BRIDGE_PORT=9999
VPS="root@152.32.235.14"
VPS_SSH_PORT=22222

echo "Starting Claude Bridge on port $BRIDGE_PORT..."
node /Users/kyleqi/projects/agent-board/claude-bridge.js &
BRIDGE_PID=$!

sleep 1

echo "Opening SSH reverse tunnel (VPS:$BRIDGE_PORT → Mac:$BRIDGE_PORT)..."
ssh -N -R 127.0.0.1:${BRIDGE_PORT}:127.0.0.1:${BRIDGE_PORT} -p $VPS_SSH_PORT $VPS &
SSH_PID=$!

cleanup() {
  echo "Shutting down..."
  kill $BRIDGE_PID $SSH_PID 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM

echo "Claude Bridge active. AI comments enabled on ab.y.dog."
echo "Press Ctrl+C to stop."
wait
