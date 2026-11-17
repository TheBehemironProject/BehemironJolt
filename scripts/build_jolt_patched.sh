#!/usr/bin/env bash
# Build the patched JoltPhysics.js (wasm-compat) on Windows Git Bash.
# Prereq: vendor/emsdk installed & activated (SSL_CERT_FILE may need pinning, see LEDGER).
set -e
cd "$(dirname "$0")/../vendor/joltphysics-js"
source ../emsdk/emsdk_env.sh
NINJA="/f/Ninja_GN/ninja.exe"
cmake -B Build/Release/ST -G Ninja -DCMAKE_MAKE_PROGRAM="$NINJA" -DCMAKE_BUILD_TYPE=Distribution -DBUILD_WASM_COMPAT_ONLY=ON
cmake --build Build/Release/ST
echo "BUILD-DONE"
