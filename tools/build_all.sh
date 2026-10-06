#!/usr/bin/env bash
# Rebuild everything from the supplied assets in assets/ and render the film.
#   ./tools/build_all.sh            full pipeline
#   SKIP_RENDER=1 ./tools/build_all.sh   only regenerate supporting assets + audio
set -euo pipefail
cd "$(dirname "$0")/.."

[ -d node_modules ] || npm install
npx playwright install chromium >/dev/null
[ -d .venv ] || { uv venv .venv --python 3.13; uv pip install --python .venv/bin/python -r requirements.txt; }
source .venv/bin/activate

python tools/extract_logo.py >/dev/null           # matte + split assets/logo.png into parts
python tools/extract_brand.py                      # corner panels from assets/banner.png
node tools/make_art.mjs vista panels               # procedural ink / halftone manhua art
python tools/make_trace.py                         # silhouette trace of the vista
python tools/audio.py                              # procedural score + sound design -> build/audio.wav

if [ -z "${SKIP_RENDER:-}" ]; then
  node tools/render.mjs --workers "${WORKERS:-5}" --crf "${CRF:-19}" --out build/video.mp4
  mkdir -p output
  ffmpeg -y -loglevel error -i build/video.mp4 -i build/audio.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest output/mantis_promo_1080p60.mp4
  node tools/render.mjs --poster 30.4 output/mantis_promo_poster.png
  echo "done -> output/mantis_promo_1080p60.mp4"
fi
