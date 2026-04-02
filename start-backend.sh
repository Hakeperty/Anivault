#!/bin/bash
# AniVault Backend - Quick Start
# Runs a local metadata-only AniWatch backend at localhost:6969 for the app.

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/anivault-backend"

cd "$BACKEND_DIR" || exit 1

if [ ! -d node_modules ]; then
    echo "📦 Installing backend dependencies..."
    if ! npm install; then
        if command -v yarn >/dev/null 2>&1; then
            echo "⚠️ npm install failed, trying yarn install..."
            yarn install
        else
            exit 1
        fi
    fi
fi

echo "🔥 Starting AniVault backend on http://localhost:6969"
node server.js
