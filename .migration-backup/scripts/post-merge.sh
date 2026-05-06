#!/bin/bash
set -e

echo "==> Installing dependencies..."
npm install --legacy-peer-deps

echo "==> Creating placeholder directories for optional native bindings..."
mkdir -p node_modules/@unrs/resolver-binding-win32-ia32-msvc

echo "==> Post-merge setup complete."
