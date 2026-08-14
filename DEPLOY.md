# 行远途记 · 后端部署与本地联调说明

账号 + 行程 + 分享协作的后端，位于 `cloudfunctions/api/`。同一份代码两种运行形态：

| 形态 | 命令 | 数据落在 |
|---|---|---|
| 本地联调（推荐先跑通） | `npm run dev` 打开 `http://localhost:3000` | `work/cloud-dev.json` |
| 微信云开发（正式） | 开发者工具上传云函数 | 云数据库 |

## 一、本地跑通（5 分钟）

`server.js` 已把账号/行程云函数路由挂载到同一端口（`/api/auth/*`、`/api/trips/*`）。

```bash
npm run dev
# 打开 http://localhost:3000
```

页面右上角「登录」即可注册、登录、建行程、分享协作。也可直接 curl 验证：

```bash
# 注册
curl -s -X POST localhost:3000/api/auth/register -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"pass123456"}'
# → {"ok":true,"token":"...","user":{...}}   记下 token

# 登录
curl -s -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"pass123456"}'

# 带 token 创建行程
curl -s -X POST localhost:3000/api/trips -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <token>" -d '{"name":"川西环线"}'
```

自动化测试：`npm run test:api`（后端接口 7 用例）+ `npm run test:unit`（含前端会话/云分流 6 用例）。

## 二、部署到微信云开发

### 1. 准备

- 微信开发者工具 → 导入项目（AppID：`wx7e7f29848ea9baa8`）
- 工具栏「云开发」→ 开通 → 创建环境（免费套餐）

### 2. 创建云函数

- 在开发者工具中右键 `cloudfunctions/api` → 「创建并部署：云端安装依赖」
- 云函数目录：`cloudfunctions/api/`（内含独立 `package.json`，依赖 `wx-server-sdk`）

### 3. 创建云数据库集合（必须手动建，add 不会自动建）

在云开发控制台 → 数据库，创建 4 个集合：

| 集合名 | 用途 | 建议权限 |
|---|---|---|
| `users` | 用户（openid / username / password_hash） | 仅管理端可读写 |
| `sessions` | 登录 token（30 天过期） | 仅管理端可读写 |
| `trips` | 行程（data 为完整行程 JSON） | 仅管理端可读写 |
| `trip_members` | 行程成员（owner / editor） | 仅管理端可读写 |

> 所有读写都经云函数（管理端权限），前端不直接碰数据库，因此集合权限统一设「仅管理端」。

### 4. 配置 HTTP 触发器

云开发控制台 → 云函数 `api` → 触发器中添加「HTTP 访问服务」，路径 `/`，方法全部允许。
之后接口地址形如：

```
https://<env-id>.service.tcloudbase.com/api/auth/register
```

### 5. 小程序端调用

小程序 wx.request 直接请求上述 HTTPS 地址即可（云开发默认域名已备案、免额外配置）。
小程序无感登录调用：

```js
wx.login({
  success: ({ code }) => {
    wx.request({
      url: 'https://<env-id>.service.tcloudbase.com/api/auth/wx-login',
      method: 'POST',
      data: { code },
      success: ({ data }) => { /* data.token 存入 storage，后续请求带 Authorization */ },
    });
  },
});
```

## 三、接口清单

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | `/api/auth/register` | 否 | web 注册 `{username, password, nickname?}` |
| POST | `/api/auth/login` | 否 | web 登录 → `{token, user}` |
| POST | `/api/auth/wx-login` | 否 | 小程序 `{code}` → openid 登录 → `{token, user}` |
| GET | `/api/auth/me` | 是 | 当前用户 |
| GET | `/api/trips` | 是 | 我的行程 `{trips: {mine, shared}}` |
| POST | `/api/trips` | 是 | 新建行程 `{name, data?}`（创建者即 owner） |
| GET | `/api/trips/:id` | 是 | 单行程（需 owner/editor） |
| PUT | `/api/trips/:id` | 是 | 更新 `{name?, data?}` |
| DELETE | `/api/trips/:id` | 是 | 删除（仅 owner） |
| POST | `/api/trips/join` | 是 | 凭分享码加入 `{share_code}` |
| POST | `/api/trips/:id/share` | 是 | owner 开关分享 `{enabled}` |
| GET | `/api/trips/:id/members` | 是 | 协作者列表 |
| GET | `/api/geocode` | 是 | 高德地理编码/地点检索 `?address=&keyword=&city=` |
| GET | `/api/place-photos` | 是 | 高德地点图片 `?name=&address=` |
| GET | `/api/place-details` | 是 | 高德 POI 详情 `?name=&address=` |
| POST | `/api/route` | 是 | 高德驾车/步行/骑行/公交路线 `{origin, destination, waypoints?, mode?, strategy?}` |
| GET | `/api/weather` | 是 | 逐小时天气 `?latitude=&longitude=&date=&time=`（和风优先，Open-Meteo 兜底） |
| GET | `/api/preview-mode` | 否 | 预览模式（按 UA 返回 mobile/desktop） |

鉴权方式：请求头 `Authorization: Bearer <token>`。高德/天气类接口必须登录（公网域名防未授权消耗配额）。

## 四、网页端复用公用域名（手机网页接入云开发）

网页端（`public/`，含手机端优化布局）可以直连云函数公用域名，与小程序共用同一套账号与行程数据。

### 1. 云函数配置环境变量

云开发控制台 → 云函数 `api` → 配置 → 环境变量，添加：

| 变量名 | 值 | 必填 | 说明 |
|---|---|---|---|
| `AMAP_WEB_SERVICE_KEY` | 你的高德 Web 服务 Key（与 `server.js` 的 `.env` 相同） | 是 | 网页端定位/路线/图片/详情查询 |
| `QWEATHER_API_KEY` | 和风天气 Key | 否 | 配置后天气优先走和风，否则回退 Open-Meteo（免 Key） |

保存后重新部署云函数。**Key 只存在云端环境变量，不进入代码和页面。**

### 2. 重新部署云函数

```bash
node scripts/build-cloud-single.mjs   # 可选：同步生成单文件版（控制台在线粘贴用）
```

然后在开发者工具右键 `cloudfunctions/api` → 「上传并部署：云端安装依赖」。

### 3. 网页端指向公用域名

把网页（`public/`）部署到任意静态托管（云开发静态托管 / GitHub Pages），并在 `index.html` 的 `<head>` 注入：

```html
<script>window.__API_BASE__ = 'https://cloud1-d0giwgf98368c9398.service.tcloudbase.com';</script>
```

网页端 `bootstrap.js` 会自动读取该值，全部请求（账号/行程/高德/天气）指向公用域名。不注入则保持同源（本地 `server.js`）行为不变。

> 注意：网页端只能使用账号密码登录（`register` / `login`）；`wx-login` 依赖微信环境，网页调用会走 mock 身份，不安全，不要使用。

### 4. 跨域（CORS）

云函数代码已内置 CORS 响应头与 OPTIONS 预检（`Access-Control-Allow-Origin: *`），浏览器直连无需额外配置；如云开发控制台 HTTP 访问服务另有跨域开关，一并开启即可。

## 五、权限模型速记

```
访客（未登录）       → 401（含高德/天气类接口）
owner（创建者）      → 编辑 / 删除 / 管理分享 / 查看成员
editor（凭码加入）   → 查看 / 编辑，不可删除、不可管理分享
未加入者            → 403
```

## 六、目录结构

```text
cloudfunctions/api/
├── index.js      # 入口：路由分发 + 鉴权 + 本地 server + 云函数 main
├── store.js      # 数据访问层（LocalStore JSON 文件 / CloudStore wx-server-sdk）
├── security.js   # scrypt 密码哈希 + token（Node 内置 crypto，零第三方依赖）
├── routes/
│   ├── auth.js   # register / login / wx-login / me / bind
│   ├── trips.js  # trips CRUD / join / share / members / schedule / plan / locations / expenses
│   └── amap.js   # geocode / place-photos / place-details / route / weather（高德+天气，无新依赖）
└── package.json  # 依赖仅 wx-server-sdk

单文件版（控制台在线粘贴用）：`cloudfunctions/api-single/index.js`，由 `scripts/build-cloud-single.mjs` 生成。

前端接入（技术底座，UI 待设计稿替换）：
public/
├── services/account.js      # 会话管理：token 存取、登录恢复、行程列表
├── services/account-keys.js # localStorage key 常量
├── services/api.js          # 自动带 token、auth/trips 接口、云分流
├── account-ui.js            # 登录/注册/行程列表占位 UI
├── account.css              # 占位样式
└── bootstrap.js             # 静默恢复登录态并注入 activeTrip

微信小程序（骨架，见 miniprogram/README.md）：
project.config.json          # AppID、miniprogramRoot、cloudfunctionRoot
miniprogram/
├── app.js / app.json / app.wxss
├── config.js                # API_BASE（本地 localhost:3000 / 云端 service.tcloudbase.com）
├── utils/request.js         # promise 化请求 + token + 401 重登
└── pages/                   # login / trips / trip
```
