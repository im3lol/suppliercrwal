#!/bin/bash
cd /home/z/my-project
while true; do
  node node_modules/.bin/next dev -p 3000
  echo "Next.js died, restarting in 3s..." >&2
  sleep 3
done
