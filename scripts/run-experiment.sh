#!/usr/bin/env sh
set -eu

echo "Phase 1 only provides the experiment entrypoint."
echo "Later phases will run k6, collect Docker stats, and export processed results."
