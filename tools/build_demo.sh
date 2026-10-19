#!/bin/sh
# Rebuild the fictional demo page (branch claude/demo-app): data, trade demo, view-only page. See DEMO.md.
# The data is the same on every run; the sample trades are dated from the build day on, so rebuild before republishing.
set -e
cd "$(dirname "$0")/.."
python3 tools/make_demo_data.py
node tools/demo_trades.js demo/records.json > demo/trades.json
python3 tools/build_artifact.py dist/demo.html --snapshot demo/records.json --demo demo/trades.json --banner "Demo · fictional data"
