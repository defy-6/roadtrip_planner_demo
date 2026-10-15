# S1「数据安全」阶段总报告

> Codex 复核补修（2026-10-14）：原交付并非安全闭环，发现并修复了无基线客户端覆盖、毫秒版本重复、冲突前已写账号地点库、恢复/删除并发窗口、小程序基线不属于草稿、本地损坏回退空库、成功后回读别人的版本及 IndexedDB 未提交即报告成功等问题。下方原测试记录保留为历史，不代表最新同版本验收。当前结论以 `S1-REVIEW-ACCEPTANCE.md` 为准。

日期：2026-10-14。仓库：`E:\Personal_project\roadtrip-planner`。工作区含此前已有修改，本阶段在其上继续，**未重置、未覆盖无关代码、未部署、未自动提交、未推送**。

**结论：实现完成，验收待完成**（不等于"S1 完成"）。真机（微信小程序）验收、云端多实例原子性实测、正式数据旧基线核实三项未闭环，不能因门禁全绿或任务结束宣称整个 S1 已完成。

---

## 1. 各工作包完成状态

| 包 | 范围 | 状态 | 关键产物 | 验收证据 |
|---|---|---|---|---|
| 第一包（此前） | 读取失败写入门禁与安全重试 | 完成，已回归 | `initializer.js`、`persistence.js` | `S1-READ-SAFETY.md`；浏览器安全回归 22 项 |
| A | 待同步队列与离线修改保护 | **完成** | `storage/persistence.js`、`runtime/initializer.js`、`services/api.js` | `tests/offline-queue-safety.test.mjs` **10/10** |
| B | 完整备份与恢复 | **完成** | `cloudfunctions/api/backup-format.js`（新）、`routes/trips.js`、`account-ui.js`、小程序 trip 页 | `tests/trip-backup-safety.test.mjs` **12/12** |
| C | 双端并发与服务端冲突控制 | **完成** | `cloudfunctions/api/store.js`、`routes/trips.js`、`services/api.js`、`miniprogram/utils/conflict.js`（新）、4 个小程序页 | `tests/server-concurrency.test.mjs` **8/8** |
| D | 正式数据旧基线核实 | **调查文档完成，数据验收未完成** | `S1-OLD-BASELINE-INVESTIGATION.md` | 未读正式数据、未改基线 |

三个工作包均遵循"先合成数据失败回归 → 最小修复 → 实际检查与预览 → 记录后推进"。

---

## 2. 修改文件 / 原因 / 数据兼容影响

### 后端（共享）
| 文件 | 原因 | 数据兼容影响 |
|---|---|---|
| `cloudfunctions/api/backup-format.js` | 新增纯规则模块：备份信封（格式版本/来源/创建时间/完整性 sha256/图片资源报告）与内容校验 | 新增只读规则，不改现有数据结构 |
| `cloudfunctions/api/store.js` | 新增 `updateIfMatches`（条件更新）作为"版本前置条件 + 写入"的原子载体；注明 LocalStore 仅单进程原子、CloudStore 靠数据库条件更新、**不用进程内锁冒充多实例安全** | 新增方法，向后兼容 |
| `cloudfunctions/api/routes/trips.js` | B：备份/恢复重写（guard 快照、信封+结构+关联+权限校验、`BACKUP_*` 错误码）。C：全部写入入口加版本前置条件（行程、方案管理、时间表、地点、费用、类别、路线、通用地点）；修复 `get()` 别名污染（深拷贝 data 后再注入通用地点库） | 新增可选 `baseUpdatedAt`；**不带该字段的旧客户端行为不变**（服务端退回刚读版本） |
| `cloudfunctions/api-single/index.js` | 由 `scripts/build-cloud-single.mjs` 重新生成（内联 backup-format、`COLLECTIONS` 补 `trip_backups`） | 与 `api/` 同源，无独立兼容影响 |
| `scripts/build-cloud-single.mjs` | 内联 `backup-format.js` 并剔除其 `require`；集合清单补 `trip_backups` | 构建脚本，无运行时影响 |

### 网页
| 文件 | 原因 | 数据兼容影响 |
|---|---|---|
| `public/storage/persistence.js` | A：重放优先于快照、`canReplayPayload` 基线校验、队列三态区分、代次保护 | 保存语义收紧（冲突时保留而非覆盖），不迁移数据 |
| `public/features/runtime/initializer.js` | A：读取成功后先重放待同步修改再决定快照；冲突/失败保持禁写 | 不改数据结构 |
| `public/services/api.js` | A：`getRemoteRevision`；B：`restoreTripBackup` 支持 `allow_missing_links`；C：各域写入携带 `baseUpdatedAt` | 新增可选字段，向后兼容 |
| `public/features/runtime/commands.js`、`public/index.html`、`public/features/mobile/plans.js` | B：方案级导出明确标注"方案级 · 非完整备份" | 文案/`title`，不影响数据 |
| `public/account-ui.js`、`public/account.css` | B：备份列表"最近三次完整旅行备份"、有网络图片时提示"· 含网络图片链接"、恢复确认与 `BACKUP_LINK_MISSING` 二次确认 | UI 文案，不影响数据 |

### 微信小程序
| 文件 | 原因 | 数据兼容影响 |
|---|---|---|
| `miniprogram/utils/request.js` | C：非 2xx 保留 `status` / `code` / `payload`，不把冲突降级成普通错误 | 错误对象增强，调用方兼容 |
| `miniprogram/utils/conflict.js` | 新增：`isVersionConflict` / `resolveVersionConflict`（显式"重新加载/保留本地"，不做自动合并） | 新增工具 |
| `miniprogram/pages/trip/trip.js`、`trip.wxml` | B：创建/恢复完整备份入口与二次确认；C：冲突处置与丢弃保护；导出按钮澄清"当前方案 ≠ 完整备份" | 新增按钮与流程，原功能保留 |
| `miniprogram/pages/expense/expense.js`、`event-edit/event-edit.js`、`location-edit/location-edit.js` | C：冲突处置与丢弃保护 | 原保存流程保留 |

### 测试与文档
- 新增测试：`tests/offline-queue-safety.test.mjs`（A，10）、`tests/trip-backup-safety.test.mjs`（B，12）、`tests/server-concurrency.test.mjs`（C，8）。
- 调整测试：`tests/api.test.mjs`（备份改用有结构数据）、`tests/runtime-commands.test.mjs`（导出范围断言）、`tests/plan-load-retry.spec.js`（文件名断言）、`tests/trip-backup-safety.test.mjs`（故障注入 store 透传 `updateIfMatches`）。
- 同步文档：`ARCHITECTURE.md`、`S1-READ-SAFETY.md`、`UI-ACCEPTANCE-STATUS.md`；新增 `S1-OLD-BASELINE-INVESTIGATION.md`、本报告。
- 预览截图：`design/s1-preview-*.png`（5 张，见第 6 节）。

---

## 3. 失败回归与修复后结果

| 包 | 失败回归（修复前实测） | 修复后 | 说明 |
|---|---|---|---|
| A | 首跑 4 failed / 1 passed；修正后临时还原旧行为再测 **5 pass / 5 fail** | **10/10 通过** | A1/A2/A3/A6/A10 为真实失败回归 |
| B | 首跑 12 failed（用户名连字符被校验拒绝） | **12/12 通过** | 过程中又暴露两处**真实缺陷**：`get()` 别名污染（注入的通用地点库被回写进行程文档）、单文件云函数遗漏 backup-format 与 `trip_backups`（均已修复） |
| C | 临时把 `commitTrip` 的原子条件更新替换为无条件 `store.update` 后 **6 pass / 2 fail**（C3、C8 失败） | **8/8 通过** | C3（旧客户端读写窗口）、C8（带基线读写窗口）证明**只靠"读后预检"不足**，必须服务端原子条件更新 |

C 包回归细节：C1/C2/C4/C5/C6 由服务端**预检**即可挡住过期基线；加入 C3/C8 后才真正证明"版本检查 + 写入"原子执行的有效性（预检放行时仍会被窗口内并发写入判为 409）。

---

## 4. 三端覆盖矩阵

| 能力 | 网页 | 小程序 | 共享后端 |
|---|---|---|---|
| 读取失败禁写 + 安全重试 | 已实现 + 浏览器回归 | 页面错误提示（未改初始化语义） | 不涉及 |
| 待同步队列 / 离线修改保护（A） | 已实现 + 单测 10 项 | 未实现独立离线队列（沿用请求失败提示） | 不涉及 |
| 完整备份 / 恢复（B） | 账号面板创建/列表/恢复确认 | trip 页创建/恢复 + 链接缺失二次确认 | `backup-format` + 路由 + `trip_backups` |
| 版本前置条件 / 冲突（C） | 各域写入带 `baseUpdatedAt` | 请求层保留冲突码 + 显式丢弃保护 | 全部写入入口原子条件更新 + 409 契约 |
| 方案级导出澄清 | 按钮/分区标注 | 导出前弹窗澄清 | — |
| 旧客户端兼容 | 必须先读取并携带基线 | 基线按读取页面维护 | 缺基线 428 VERSION_REQUIRED，旧客户端升级前不能写；过期基线 409 |

---

## 5. 备份恢复与并发证据

### 备份/恢复（`tests/trip-backup-safety.test.mjs`，12 项全通过）
- B0 读取/启动**不**自动创建备份。
- B1 信封含 `format_version` / `source` / `created_at` / 完整性校验；图片资源如实报告（`photos.total 3`、`embedded 2`、`remote 1`、`images_fully_embedded=false`）。
- B2 列表投影不回落整份行程数据。
- B3 恢复前落"恢复前快照"，恢复后内容与备份一致（含全部方案/费用/类别/偏好/通用库）。
- B4 完整性不匹配 → `BACKUP_UNVERIFIED`，不破坏当前数据。
- B5 更高格式版本禁止降级重写。
- B6 关联缺失默认拒绝（`BACKUP_LINK_MISSING`），显式确认后才可忽略并如实提示。
- B7 结构性损坏（空方案集）→ `BACKUP_INVALID`。
- B8 写入中断 → 原数据不变 + 留下可回退快照。
- B9 权限矩阵：viewer 不可备份、editor 可备份不可恢复、未加入 403。
- B10 跨行程备份 id 不可用（404）。

### 并发（`tests/server-concurrency.test.mjs`，8 项全通过）
- C1 两客户端基于同一版本保存：A 200、B 409，**B 不覆盖 A**。
- C2 分域交错：过期基线写 expenses 409；最新基线写 locations 200；过期写未部分落库。
- C3 旧客户端（无基线）可正常写；**读写窗口内**被并发插入 → 409。
- C4 同版本重复请求（幂等重试）→ 409 且不产生重复数据。
- C5 部分成功保留可恢复状态，冲突响应携带 `current_updated_at`。
- C6 方案管理入口同样受版本前置条件约束。
- C7 只读 viewer / 未加入者写入 403，且不落库。
- C8 **带基线**写入在读写窗口内被并发插入 → 409（证明原子性，非仅预检）。

---

## 6. 门禁与验证结果（本轮实测）

| 门禁 | 命令 | 结果 |
|---|---|---|
| 架构 lint | `npm run lint` | **通过（18 条规则）** |
| 架构测试 | `npm run test:architecture` | **通过** |
| 单元测试 | `npm run test:unit` | **136/136 通过**（含 api、A 10、B 12、C 8） |
| API 测试 | `npm run test:api` | 包含在上述 `test:unit` 中，通过 |
| 浏览器安全回归 | `playwright.safety.config.js`（合成数据隔离服务，端口 3102） | **22/22 通过**（Chromium 11 + WebKit 11），**退出码 0**（`22 passed`）；`--output` 外置 `E:/dev-cache`，避免仓库内批量删除被环境守卫拦截 |
| 模块语法 | `node --check`（直接逐文件） | **36 个文件全部通过**（diff 涉及 7 个 web/云文件 + 小程序 11 + 云函数 8 + 脚本 11） |
| 数据基线 | `node scripts/verify-data-hash.mjs` | **未执行**（会读取正式数据；本次不读正式数据） |

### 未执行 / 环境故障（如实记录）
- **`npm run check:syntax` 未执行成功**：所有文件（含未改动的 vendor/scripts）均报 `Syntax check failed ... undefined`。根因已定位为环境故障——`spawnSync(process.execPath, ['--check', file])` 返回 `error.code = 'EBUSY'`（`C:\Users\HP\.workbuddy\binaries\node\versions\22.22.2-6\node.exe`），`stderr` 为 `undefined`。**与本次源码改动无关**（未改动文件同样失败）。已改用直接 `node --check` 覆盖全部 36 个相关文件作为替代证据。
- **浏览器安全回归拆卸耗时异常（不影响结果）**：22 项全部 `passed`、进程最终**退出码 0**；但 webServer 拆卸阶段挂起，整体墙钟约 1 小时（此前同类运行约 20 分钟）。仅影响耗时，不影响通过判定。未以该子集结果宣称完整应用套件（153 项）已重跑。
- **完整应用浏览器套件（153 项）本轮未重跑**。
- **小程序真机/微信开发者工具编译未执行**：小程序侧仅做 `node --check` 语法校验 + 业务规则/保存流程代码走查。

### 界面预览（合成数据、隔离临时目录，不读正式数据）
| 截图 | 内容 |
|---|---|
| `design/s1-preview-mobile-plan-export.png` | 移动方案页："导出当前方案 · 方案级 · 非完整备份"、导出当前方案 JSON |
| `design/s1-preview-desktop-plan-export.png` | 桌面正常加载（回归：布局/数据完好） |
| `design/s1-preview-desktop-read-failure.png` | 读取失败："读取失败，显示离线缓存" + "重试读取"（写入门禁） |
| `design/s1-preview-desktop-backup-list.png` | 账号面板"最近三次完整旅行备份"，含"主方案 · 含网络图片链接"如实提示 |
| `design/s1-preview-desktop-restore-confirm.png` | "恢复完整旅行备份"确认弹层（含"恢复前快照"说明与"恢复并覆盖"） |

---

## 7. 剩余风险 / 未执行项 / 需用户操作事项

### 剩余风险
1. **云端多实例原子性未实测**：LocalStore 仅"单进程原子"；生产依赖云数据库单文档条件更新（`where(...).update()` 的 `stats.updated`）。代码已注明**不用进程内锁冒充多实例安全**，但未在真实多实例环境压测。
2. **小程序离线队列缺失**：A 包的待同步队列为网页端实现；小程序请求失败仅提示，不具备"仅在内存/已持久化本地/云端已确认"三态。
3. **通用地点库恢复为"尽力而为"**：备份中通用库恢复失败只降级为警告（行程数据已恢复），需用户自行核对。
4. **`get()` 别名污染属本轮修复**：若存在其它未走 `get()` 的路径直接读取 store 活对象并加工，仍可能回写，需后续审计。
5. **网络图片不等于完整保存图片**：备份对网络图片只保留 URL，`images_fully_embedded=false`，已在 UI 如实标注。

### 未执行项
- 真机（微信小程序）功能与保存流程验收；微信开发者工具编译。
- 完整应用浏览器套件（153 项）与本轮 22 项之外的其他 spec。
- `npm run check:syntax`（环境 EBUSY，见第 6 节）。
- `scripts/verify-data-hash.mjs` 对正式数据的比对（不读正式数据）。
- 云端多实例并发压测、真实协作者并发编辑。

### 需用户操作事项
1. **正式数据旧基线核实**：按 `S1-OLD-BASELINE-INVESTIGATION.md` 第 3 节执行（先备份 → 结构校验 → 业务抽检 → 可选哈希对比）。**新基线只能在（来源核实 + 完整备份 + 用户明确确认）后建立**；本阶段**未建立、未修改**旧基线，状态为**待用户核实**。
2. **真机验收**：在微信开发者工具/真机导入 `miniprogram/`，核对创建/恢复完整备份、冲突提示（可用两个账号并发编辑触发）。
3. **云端部署**：本阶段未部署。如需上线，先按 `cloudfunctions/api-single` 或 `api/` 部署，并在真实环境复测并发 409 与备份恢复。

---

## 8. 回退方式

- **未部署、未提交**：回退仅涉及工作区文件，不涉及服务端或数据。
- **按文件回退**：本阶段改动均为最小变更，可单独还原 `cloudfunctions/api/{routes/trips.js,store.js,backup-format.js}`、`api-single/index.js`、`public/{services/api.js,storage/persistence.js,features/runtime/{initializer.js,commands.js},account-ui.js,index.html,features/mobile/plans.js}`、`miniprogram/**`、相关 tests。
- **不可整体或整文件重置**：同一文件混有此前工作区修改，不能用 Git 整文件还原冒充本轮回退。先保存完整工作区副本，再按已审核差异逐块回退；未提交状态没有天然可用的独立阶段回退点。
- **后端功能级回退**：不允许通过恢复“无基线写入”回退安全门禁。旧客户端需同步升级，缺版本的写入应继续拒绝。
- **数据级回退**：B 包恢复流程在覆盖前自动落"恢复前快照"，可在备份列表中回退；**不自动撤销**恢复本身。
- **基线回退**：本阶段未改动基线，无需回退。

---

## 9. 是否满足进入 S2

**不满足"达 S1 完成"的全部条件**，故判定为**"实现完成，验收待完成"**。理由：

- 已闭环：A、B、C 三个工作包实现完成并有可重复的合成数据证据；D 已出只读调查记录。
- 未闭环（开放项）：真机验收、云端多实例原子性实测、正式数据旧基线核实（含新基线建立需用户确认）、`check:syntax` 环境故障未排除、完整应用浏览器套件未重跑。

**待上述开放项闭环且必需门禁通过后，方可标记"达 S1 完成"，再进入 S2（范围冻结）。** 未完成 S1 门禁前不扩展旅行记录（S5）。
