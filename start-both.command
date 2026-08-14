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

cleanup() {
  kill "$desktop_pid" "$mobile_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

npm run dev:desktop &
desktop_pid=$!
npm run dev:mobile &
mobile_pid=$!

sleep 1
open "http://localhost:3000/"
open "http://localhost:3001/"

wait
