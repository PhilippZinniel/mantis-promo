#!/usr/bin/env bash
# Rebuild everything from the supplied assets in assets/ and render the film.
#   ./tools/build_all.sh                      full pipeline -> output/
#   SKIP_RENDER=1 ./tools/build_all.sh        only regenerate supporting assets + audio
#   CLEAN=1 ./tools/build_all.sh              wipe node_modules/.venv/build first (fully clean rebuild)
#   WORKERS=5 CRF=19 ./tools/build_all.sh     renderer parallelism / H.264 quality
set -euo pipefail
cd "$(dirname "$0")/.."

for tool in node npm uv ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "missing required tool: $tool (see README: Requirements)" >&2; exit 1; }
done
[ -z "${CLEAN:-}" ] || rm -rf node_modules .venv build

[ -d node_modules ] || npm ci                                  # exact versions from package-lock.json
npx playwright install chromium >/dev/null
[ -d .venv ] || { uv venv .venv --python "$(cat .python-version)" && uv pip install --python .venv/bin/python -r requirements.txt; }
source .venv/bin/activate

python tools/extract_logo.py >/dev/null           # matte + split assets/logo.png into parts
python tools/extract_brand.py                      # corner panels from assets/banner.png
node tools/make_art.mjs vista panels wall          # procedural ink / halftone manhua art + the library of distinct pages
python tools/make_trace.py                         # silhouette trace of the vista
python tools/audio.py                              # procedural score + sound design -> build/audio.wav (timing from src/cues.json)

if [ -z "${SKIP_RENDER:-}" ]; then
  mkdir -p output
  node tools/render.mjs --workers "${WORKERS:-5}" --crf "${CRF:-19}" --out build/video.mp4
  ffmpeg -y -loglevel error -i build/video.mp4 -i build/audio.wav -c:v copy -c:a aac -b:a 256k -ar 48000 -movflags +faststart -shortest output/mantis_promo_1080p60.mp4
  node tools/render.mjs --poster "$(python -c "import json;print(json.load(open('src/cues.json'))['t']['lock']+1.6)")" output/mantis_promo_poster.png
  python tools/contact_sheet.py output/mantis_promo_1080p60.mp4 output/mantis_promo_contact_sheet.jpg
  echo "done -> output/mantis_promo_1080p60.mp4"
fi
