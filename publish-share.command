#!/bin/zsh
set -e

cd "$(dirname "$0")"

if ! git diff --cached --quiet; then
  osascript -e 'display alert "无法自动发布" message "暂存区已有其他改动，请先提交或取消暂存后再发布。"'
  exit 1
fi

npm run build:share
git add -f docs
git add .github/workflows/deploy-pages.yml public package.json package-lock.json README.md publish-share.command scripts/build-share.mjs

if git diff --cached --quiet; then
  osascript -e 'display notification "当前没有需要发布的行程更新" with title "行远共享页"'
  exit 0
fi

git commit -m "更新共享行程"
git push origin main
osascript -e 'display notification "已推送，GitHub Pages 正在更新（通常约 1 分钟）" with title "行远共享页"'
