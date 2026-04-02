#!/bin/bash
# AniVault Backend - Quick Start
# Run this in Termux to start the local anime metadata server
# The AniVault app will auto-detect it at localhost:6969

cd "$(dirname "$0")/anivault-backend" || exit 1

if [ ! -d node_modules ]; then
    echo "📦 Installing dependencies..."
    if command -v yarn &>/dev/null; then
        yarn install
    else
        npm install
    fi
fi

echo "🔥 Starting AniVault Backend..."
node server.js
