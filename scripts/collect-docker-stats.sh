#!/usr/bin/env sh
set -eu

docker stats --no-stream --format '{{json .}}'
