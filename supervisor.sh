#!/bin/bash
# Supervisor script that keeps Next.js dev server alive
cd /home/z/my-project
while true; do
  # Kill any existing
  fuser -k 3000/tcp 2>/dev/null
  sleep 2
  
  # Start server
  node node_modules/.bin/next dev -p 3000 &
  SERVER_PID=$!
  
  # Wait for it to start
  sleep 6
  
  # Keep it alive with pings, restart if it dies
  while true; do
    sleep 8
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      echo "$(date) Server died, restarting..." >> /home/z/my-project/supervisor.log
      break
    fi
    # Ping to keep alive
    curl -4 --max-time 3 -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null || true
  done
done
