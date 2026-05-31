#!/bin/bash
cd /home/z/my-project/mini-services/crawleo-service
while true; do
  python3 server.py
  echo "Service died, restarting in 3s..." >&2
  sleep 3
done
