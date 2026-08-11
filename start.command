#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "无法启动" message "未检测到 Node.js。请先安装 Node.js 20 或更高版本。"'
  exit 1
fi

if [[ ! -d node_modules ]]; then
  npm install
fi

open "http://localhost:${PORT:-3000}"
exec npm run dev
