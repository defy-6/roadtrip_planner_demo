# 行远途记 · 微信小程序

小程序前端骨架（`miniprogram/`）+ 后端云函数（`cloudfunctions/api/`），与 web 端共用同一套账号与行程数据。

## 页面结构

```
pages/
├── login/   # 登录：微信无感登录（wx.login → openid）+ 账号密码登录/注册
├── trips/   # 行程列表：我的/协作的、新建、分享码加入
└── trip/    # 行程详情：数据摘要、分享开关（owner）与分享码复制
```

## 一、导入微信开发者工具

1. 打开微信开发者工具 → 导入项目 → 目录选本仓库根目录
2. AppID 自动读取 `project.config.json`（`wx7e7f29848ea9baa8`）
3. 本地联调：开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」
4. 先启动 web 后端：仓库根目录 `npm run dev`（http://localhost:3000，含账号/行程接口）

`miniprogram/config.js` 的 `API_BASE` 默认指向 `http://localhost:3000`，无需改动即可联调。

## 二、云端部署（正式/体验版）

1. 按 `DEPLOY.md` 部署云函数 `api` 并配置 HTTP 触发器
2. 把 `miniprogram/config.js` 的 `API_BASE` 改为 `https://<env-id>.service.tcloudbase.com`
3. 开发者工具 → 上传 → 后台设体验成员即可扫码测试（无需审核）

## 三、登录链路

- **微信无感登录**：`wx.login` 拿 `code` → `POST /api/auth/wx-login` → 云函数 `cloud.getWXContext()` 取 openid → 自动注册/登录 → 返回 token
- **账号密码**：与 web 端同一 `users` 集合，两端账号互通
- token 存 `wx.setStorageSync('roadtrip-token')`，请求自动带 `Authorization: Bearer`，401 自动回登录页

## 四、现状与边界

- 当前为骨架：打通「登录 → 行程列表 → 打开行程 → 分享协作」全链路
- 完整编辑器（时间表、地图、路线）等小程序 UI 设计稿落地后迭代
- 体验版阶段数据在云开发环境，与 web 端（同一云函数/云数据库）天然互通
