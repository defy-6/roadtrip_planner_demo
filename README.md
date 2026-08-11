# 自驾游行程规划器

一个可上传/导入行程、查询高德真实驾车路线、以 Leaflet + OpenStreetMap 开源底图展示路线、管理景点照片和住宿地点的轻量原型。

## 启动

```bash
npm install
cp .env.example .env
# 编辑 .env，填入高德开放平台 Web服务 Key
npm run dev
```

访问 `http://localhost:3000`。高德 Key 仅保存在服务端 `.env`。地图采用 Leaflet 和 OpenStreetMap，不需要地图服务 Key。

macOS 下也可以双击 `start.command` 一键启动。首次使用时它会自动安装依赖。

## 行程导入格式

导入 JSON 时使用：

```json
{"name":"川西环线","items":[{"type":"spot","name":"四姑娘山","address":"四川省阿坝州小金县四姑娘山镇","date":"2026-10-01","note":"双桥沟"},{"type":"hotel","name":"四姑娘山云顶酒店","address":"四川省阿坝州小金县四姑娘山镇","date":"2026-10-01","note":"已预订"}]}
```

图片会以浏览器本地 Base64 数据保存，适合原型或小图；生产环境建议改为对象存储并保存 URL。

## 只读分享页（GitHub Pages）

共享页展示当前保存到本地文件的两版行程、时间表、地图、日期筛选、地点库和导出功能；不提供编辑、高德重新查询或天气更新，因此不会泄露任何 API Key。

首次发布前，先在本机页面确认右上角显示“已写入本地文件”，然后执行：

```bash
npm run build:share
git add -f docs
git add .github/workflows/deploy-pages.yml scripts/build-share.mjs public package.json README.md
git commit -m "发布共享行程"
git push origin main
```

之后每次更新行程后，双击 `publish-share.command` 即可重新打包当前行程并推送；朋友始终使用同一个 GitHub Pages 地址查看最新版本。首次推送后，在仓库 **Settings → Pages** 将 Source 设为 **GitHub Actions**。
