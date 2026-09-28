#!/bin/sh
# Runs the generated script (mounted into /app so it resolves puppeteer from
# /app/node_modules), then optionally converts the recordings to MP4, which
# plays in more places than the WebM that page.screencast() produces. With
# AUDIO set, the MP4 gets that file looped under it as its soundtrack.
set -e

script="$1"
[ -n "$script" ] || { echo "usage: run-demo <script file in /app>" >&2; exit 2; }

node "/app/$script"

if [ "$CONVERT_MP4" = "1" ]; then
  for f in /output/*.webm; do
    [ -e "$f" ] || continue
    if [ -n "$AUDIO" ]; then
      echo "Converting $(basename "$f") to MP4 with background audio…"
      # Cut the looped audio at the video's end, fading it out over the last
      # two seconds; without a known duration, -shortest cuts it without a fade.
      duration=$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$f" 2>/dev/null || true)
      if [ -n "$duration" ] && [ "$duration" != "N/A" ]; then
        fade_start=$(awk -v d="$duration" 'BEGIN { s = d - 2; print (s > 0 ? s : 0) }')
        audio_end="-t $duration -af afade=t=out:st=$fade_start:d=2"
      else
        audio_end="-shortest"
      fi
      # $audio_end is unquoted on purpose: it is several arguments, built above
      # from ffprobe's number only.
      ffmpeg -hide_banner -loglevel error -y -i "$f" -stream_loop -1 -i "$AUDIO" \
        -map 0:v:0 -map 1:a:0 -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 192k \
        $audio_end -movflags +faststart "${f%.webm}.mp4"
    else
      echo "Converting $(basename "$f") to MP4…"
      ffmpeg -hide_banner -loglevel error -y -i "$f" \
        -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${f%.webm}.mp4"
    fi
  done
fi
