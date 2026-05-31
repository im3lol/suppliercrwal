#!/bin/bash
# Keep-alive script to prevent sandbox from killing the Next.js server
while true; do
  sleep 10
  curl -4 --max-time 3 -s -o /dev/null http://127.0.0.1:3000/ 2>/dev/null
done
