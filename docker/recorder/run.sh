#!/bin/sh
# Runs the generated script (mounted into /app so it resolves puppeteer from
# /app/node_modules), then optionally converts the recordings to MP4, which
# plays in more places than the WebM that page.screencast() produces.
set -e

script="$1"
[ -n "$script" ] || { echo "usage: run-demo <script file in /app>" >&2; exit 2; }

node "/app/$script"

if [ "$CONVERT_MP4" = "1" ]; then
  for f in /output/*.webm; do
    [ -e "$f" ] || continue
    echo "Converting $(basename "$f") to MP4…"
    ffmpeg -hide_banner -loglevel error -y -i "$f" \
      -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
  done
fi
