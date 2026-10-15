# S2：同一版本的发布流程

S2 实现范围：统一门禁、网页产物、微信部署入口、发布记录；业务模块和数据模型不变。
发布编排归 `scripts/release.mjs`，指纹和配置校验归 `release-support.mjs`，
外部发布命令归 `deploy-release.ps1`；测试继续复用 S1 的隔离服务与合成数据。

## 1. 准备受测版本

关闭其他正在跑本项目浏览器回归的会话。安装依赖 `npm ci`，首次安装浏览器：
`npx playwright install chromium webkit`。浏览器缓存位置通过
`PLAYWRIGHT_BROWSERS_PATH` 设置，脚本不硬编码个人机器路径。

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'E:\dev-cache\playwright' # 本机已有缓存
npm run check:release -- 0.2.0
```

依次执行云函数生成、lint、语法、架构、全部单元测试、S1 安全浏览器回归和
360/430px 四页面发布冒烟。失败立即停止，记录标为 failed。

成功产物：`work/releases/0.2.0/web/` 和 `release.json`。网页只包含应用静态文件，
注入与小程序相同的 API 环境，不打包本地行程、不运行旧的 `build:share`。
同一版本的 web 目录不会覆盖；重新准备使用新版本号，或手工归档旧目录后再执行。
发布记录保存版本、提交号、工作区是否有修改、源码与网页 SHA-256、目标环境和验证结果。

```powershell
npm run release:verify -- 0.2.0
```

源码、测试、脚本、配置或网页包发生变化，校验失败，必须重新跑门禁。
工作区未提交也会计算全部源码，不会把上一次提交误当作当前受测代码。

## 2. 同版本人工验收

先完成 `S1-CLOUD-CONSOLE-CHECKLIST.md` 的控制台只读核对。
微信开发者工具打开本项目，确认环境与发布记录一致，在体验版或独立测试环境验证：

| 操作 | 通过标准 |
| --- | --- |
| 登录和读取 | 正确进入自己的行程，刷新后内容一致 |
| 编辑并保存 | 修改事件/地点/费用，再打开仍存在 |
| 两端编辑 | 第二个旧版本写入明确提示冲突，第一端内容保留 |
| 断网/失败 | 草稿留存，恢复后有明确处理入口 |
| 完整备份恢复 | 在测试行程中恢复，方案/费用/地点/类别一致 |
| 四页和方案切换 | 能滚动到底，卡片不压缩，切换后上下文正确 |

网页在 iOS Safari 和 Android 微信内置浏览器、小程序在真机验证；记录设备、
系统/微信版本、测试版本、时间、操作者、通过/失败即可，不记录密钥或真实行程内容。
自动测试通过不代表真机通过。发布前验收与发布后的冒烟分别记录。

## 3. 部署入口

先预览命令，不执行外部写入：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-release.ps1 -Version 0.2.0
```

执行时需已登录微信开发者工具并开启服务端口；网页部署还需已安装并登录
`@cloudbase/cli`（`tcb`），静态托管已开通。
微信 CLI 的位置可通过 `-WechatCli` 指定，登录令牌使用工具支持的环境变量，不能写入脚本。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/deploy-release.ps1 -Version 0.2.0 -Execute -ConsoleVerified -DeviceVerified
```

顺序为 `api` 云函数 → 网页静态托管 → 小程序上传。可用 `-Target Backend|Web|Mini`
单独重试某一步。所有工具先检查齐全；每一步前重新验证源码，失败后停止后续步骤。
已完成的外部步骤不会自动撤销，记录标为 `failed-or-partial`，保留成功步骤。
成功上传后标为 `uploaded-awaiting-post-deploy-acceptance`，不冒充已上线或验收通过。
小程序上传后仍需开发者工具体验版验收及微信后台提审/发布。
上述 ExecutionPolicy 参数只作用于本次已审查脚本的子进程，不修改系统执行策略。

网页部署命令依据 [CloudBase 官方静态托管 CLI 文档](https://docs.cloudbase.net/cli-v1/hosting)。
脚本不删除远端文件、不修改数据库集合或云端环境变量。

## 回退

发布前保留上一份通过门禁的版本目录和云函数版本。网页重传上一版 web 目录；
云函数在控制台回退到上一部署版本；小程序在微信后台按其发布能力回退。
回退代码不等于回退数据。数据问题使用 S1 完整备份恢复流程，不导入本地测试数据。

## 本包验收边界

脚本、自动门禁和失败护栏由本地验证；生产部署、真机和控制台验收状态必须按实际执行记录。
S1 控制台待确认不阻止本地完成 S2 工具，执行部署时由操作者确认。

## 本轮验证（2026-10-15）

- `npm run check:release -- 0.2.0-s2`：exit 0。
- lint 18 条、语法 132 文件、架构检查通过；单元 160/160；Chromium/WebKit 30/30。
- 生成 `work/releases/0.2.0-s2/web` 和对应 `release.json`，源码/网页指纹复验通过。
- 临时添加源码、临时添加网页包文件均被 verify 拒绝；移除测试探针后复验通过。
- 部署预览正确列出三个命令；未确认验收的执行请求被阻断，未调用外部部署工具。
- 微信 CLI 已发现；本机未发现 `tcb.cmd`，全量部署前需安装并登录 CloudBase CLI。
- 控制台和真机验收仍为 pending；本轮没有正式部署、上传、提交、推送或数据库写入。

### 后续状态

- 用户已确认真机测试通过；具体设备、系统/微信版本未提供，未代填。
- 已安装 CloudBase CLI 3.8.6；已启动浏览器设备码授权，登录是否成功以 CLI 返回为准。
- 原框架 `DEVELOPMENT-FRAMEWORK.md` 中 S2 是范围冻结，本文发布工具归属于其 S3。
  为保留已有链接与命令，文件名暂保留；不能据此认定范围冻结、CI 或 S4 全部完成。
- CLI 登录已成功，目标环境 NORMAL；五集合经 DescribeTables 只读核实存在，
  两环境变量名经用户确认存在。没有拉取变量值、读取生产记录或执行部署。

## S3：GitHub 自动门禁

`.github/workflows/deploy-pages.yml` 保留文件路径，流程名称改为 `Release gate`。
推送 main、提出 PR、手动运行都会执行：锁文件安装 → 生产依赖高危检查 → 安装 Chromium/WebKit →
与本地相同的 release prepare → 指纹复验 → 上传该次通过的产物与记录。
失败立即阻断产物交付，另存 7 天失败诊断；通过的发布包保留 14 天。
每次版本号绑定 GitHub run ID/attempt，产物名称绑定源码 SHA。

此流程只需 `contents: read`，不持有云端密钥。已删除旧的直接发布 `docs` 步骤，
不自动发布 GitHub Pages、云函数或小程序；现有线上站点不因本地修改发生变化。
正式发布仍按前述脚本执行，不将公开行程分享构建与应用发布包混用。
工作流本身纳入源码指纹，修改发布规则后旧候选版本必须重新准备。

本地 actionlint 和 YAML 策略检查只验证工作流定义；远端执行结果需要代码提交推送后
到 GitHub Actions 查看。当前工作区包含大量已有修改，本轮不自动提交或推送。
若要强制禁止未通过检查的合并，应在 GitHub 分支保护中将 `release-gate` 设为必需检查；
仓库远端设置尚未改动。通过 CI 不代表真机验收、正式部署或生产恢复演练通过。

2026-10-15 本地验证：actionlint 1.7.12、YAML 权限与失败阻断策略检查通过；
`npm run check:release -- 0.2.0-s3-ci` exit 0（lint 18 条、语法 132 文件、架构检查、
单元 160/160、浏览器 30/30）。新候选指纹复验、部署预览通过；旧 `0.2.0-s2`
因发布规则变化被拒绝，不能继续当作当前版本发布。以上不是 GitHub 远端运行结果。

### GitHub 首跑与修复

2026-10-15 已整理提交并推送 main。首次运行
[38705088885](https://github.com/defy-6/roadtrip_planner_demo/actions/runs/38705088885)
在架构 lint 阶段失败，正确跳过产物交付。原因是 Windows 分隔符导致跨功能依赖漏检，
Linux 又将 runtime 装配层误报为普通 feature。已统一导入路径、识别装配层所有权，
并修复相对/绝对路径与缓存参数导致的循环依赖漏检；Windows/Linux 正反向回归覆盖。
生产依赖使用兼容补丁修复 npm 报告，并新增高危/严重漏洞的 CI 阻断。
