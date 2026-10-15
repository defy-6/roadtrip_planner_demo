# Roadtrip Planner 目标架构

## 目标

S1 复核安全边界：共享后端统一要求读取基线（缺失 428、冲突 409），版本必须严格递增。行程和账号地点库、协作者权限变更进入同一条件事务；CloudStore 多文档使用数据库事务，不能用进程锁替代。LocalStore 文件锁下重新读取、临时文件 fsync 后原子替换，损坏/权限错误禁写，不回退空库。本地 planner 文件同样采用版本门禁。

网页 API 持有账号/行程读取上下文，保存使用本次提交返回版本，不通过末尾 GET 采用其他写入者版本。队列捕获不可变完整快照，IndexedDB 仅事务提交后报告持久化，条件清除不能删掉更晚草稿。小程序读取版本归当前页面；`utils/drafts` 独占账号/行程/页面恢复键，提交前保存不含 token 的请求与表单/源数组，恢复需明确确认且保留原版本，绝不自动重放。新旅行记录模型不在本阶段范围内。

`runtime.js` 最终只负责创建共享状态、装配 feature、连接跨 feature 事件以及启动/销毁应用，不再包含业务算法、DOM 模板和具体交互实现。继续沿用原生 ES Modules、当前 `state` 对象、JSON 数据格式和现有部署方式。

## 目录结构

移动方案列表显式切换后的焦点由 mobile/plans 管理：既有 change 完成与概览同步后，聚焦命名的当前方案 region 并回到概览顶部；其可访问描述关联现有旅行名称、日期和安排日期数。只有列表触发的切换请求此焦点，顶部 select 仍保留原焦点；离开方案页或存在其他弹窗时不抢焦点。请求标记仅为短暂 UI 状态，不进入 session、路由或保存数据，原生链接键盘策略不重写。

地点编辑表单区块由 places/editor-sections 负责图片上传、折叠详情与候选/关联容器的 DOM 组装，使用传入 dialog 的 ownerDocument 和内部节点；仅返回命名节点供 editor 协调。模块不读取 state、查询接口或保存，既有字段 ID、样式类和布局顺序不变，按页面弹窗生命周期创建一次。图片选择状态、候选回调、关联内容、查询和保存仍归 places/editor。

安排编辑器的搜索结果定位由 schedule/search-position 负责：仅接收 input/panel，监听所属表单滚动与 visualViewport 的 resize/scroll，更新固定面板坐标和可用高度。实例按结果面板创建一次，随现有页面 DOM 生命周期存在；候选排序、地点导入/选择和路线字段联动仍归 schedule/editor，不在定位模块读 state 或保存。延迟失焦只在焦点确实离开输入与结果面板后关闭，重新聚焦不被旧回调隐藏。打开编辑器的日期聚焦回退不得覆盖用户已选择的其他控件，也不得聚焦已关闭弹窗。

地点编辑上下文由 places/editor-context 仅负责 DOM 文本与描述关联，运行时提供 getContext 的 tripName/planName。安排、费用和地点编辑使用同一运行时上下文读取器，runtime/editors 保留可选注入以兼容既有调用。地点模块不从关联安排推断自己的日期，不读取存储；每次打开刷新上下文。日期仍归属既有关联安排列表，不新增地点日期数据。

地点库编辑入口通过可选 returnTarget 回调返回当前渲染中的卡片或编辑按钮，runtime 仅转交；places/editor 在关闭后解析目标并恢复焦点，不读取地点库 DOM 内部结构。保存重建卡片后不复用旧节点，原地点删除或不再可见时返回新增地点入口，不误聚焦其他地点；同时有其他弹窗打开时不抢焦点。直接新增入口返回原按钮，确认关联入口保留其原焦点。此回调只描述交互目标，不进入地点数据或保存服务。

当前方案回顾由 `features/review/model.js` 负责只读日期分组，`features/review/dialog.js` 负责弹层展示；runtime 注入现有 state、旅行/方案名称、转义函数及权限/编辑回调，并注册销毁。移动方案页通过 `mobile:review` 打开；编辑仍使用既有事件编辑器和保存流程，回顾模块不直接写入数据，不新增路由或完成状态。样式归属 `styles/mobile/review.css`。

回顾等待编辑关闭的协调逻辑归属 `features/runtime/editors.js`，返回删除/日期变化结果；runtime 仅传递该回调。回顾据此恢复位置或定位新日期，删除后不复用被下一项占据的原索引恢复焦点。该结果是交互状态，不写入现有数据结构。

关联地点定位通过 runtime 注入 schedule/view 的 changeDayFilter，先完成共享日期状态、时间表和地图概览同步，再聚焦地点；移动桥接层不得只改日期下拉框。未知草稿日期不写入筛选状态。移动日期控件复用同一同步函数响应选项重建与用户切换。回顾模块在离开方案页时关闭自身弹层，不继续遮挡地图；取消或保存编辑但未切页仍按原流程恢复回顾。

回顾的日期跳转由 `features/review/date-navigation.js` 管理本地选项、目标区块焦点和标题下方的滚动定位；日期变更后的返回复用同一定位逻辑。不改变时间表 dayFilter，不触发保存，不新增路由；空回顾禁用控件，没有日期的安排有明确选项。

照片查看器通过 getContext(button) 接收命名的 tripName、planName、date；回顾入口负责关联当前旅行/方案和图片所在日期，查看器只以 textContent 显示并用 aria-describedby 关联上下文。查看器不读取 state、网络或持久化，也不自行解析回顾日期 DOM；没有日期时明确显示未设置日期，不推断旅行日期或实际完成时间。

initializer 返回 dataStatus（ready/offline/preset/draft），每次运行首先禁用自动保存并等待已经开始的保存链结束；本次响应独立验证快照结构，旧缓存不能证明空响应有效。验证失败保留当前展示，不重建方案容器、不保存或刷新队列；有效空方案（schedule/items 数组为空）仍可正常读取。lifecycle 保留单次运行的 retry 与 planner:ready，异常标为 error；页面按该状态提供重试入口，不解析中文保存提示。

重试草稿保护归 initializer 的实例生命周期：runtime 注入 fileSavePayload/currentSnapshot 读取器与既有 confirmAction。忽略保存时间戳后比较内容；未保存修改需明确确认放弃，取消、再次读取失败或网络等待期间出现新编辑均保留当前状态，并保持禁写。验证后的 load 同步完成，再等待缓存写入，避免缓存延迟导致第二次覆盖。该保护不等于持久化离线草稿；刷新/关页前仍需导出备份。移动概览的 draft 状态显示保留修改的提示，继续提供重试及现有导出入口。

持久化模块以 generation 标记排队任务；disableAutoSave 取消尚未触发的定时任务，旧代次任务即使重新启用也不发送，队列异步读取/写入后再次检查。已经发送的请求不宣称能撤回，initializer 通过 waitForIdle 等待其结束后才更换状态。正常保存串行与版本冲突规则不变。

待同步队列（S1 工作包 A）：读取/重试成功后先重放待同步修改，再决定是否采用远端快照——有待同步修改时不得用远端快照直接覆盖；重放前检查基线版本（`canReplayPayload`），基线不等于当前权威版本即判为冲突，冲突或重放失败一律**保留队列、不发送、不清除**，也不先用旧快照保存回去。队列状态区分"仅在内存 / 已持久化本地 / 云端已确认"三态；无法持久化时明确提示"仅在内存中，刷新会丢失"。旅行切换后队列归属按 `scope:tripId` 键隔离，不跨行程误用。

完整备份与恢复（S1 工作包 B）：备份路由与纯规则模块 `cloudfunctions/api/backup-format.js` 负责信封（`format_version` / `source` / `created_at` / 完整性 sha256 / 图片资源报告）与内容校验；`routes/trips.js` 负责集合（`trip_backups`、`COLLECTIONS`）与恢复流程。恢复前必须通过信封校验 → 结构校验 → 关联校验 → 权限校验，并先落一份"恢复前快照"（guard backup），任何失败都不破坏原数据、可回退。未知**更高**版本禁止降级重写；关联缺失需用户显式确认（`allow_missing_links`）后才可忽略并如实提示。只有网络图片 URL 时不得宣称"完整保存图片"，列表投影不回落整份行程数据，也不发布到公开目录。方案级 JSON 导出（网页 `runtime/commands`、`mobile/plans`、小程序 trip 页）已明确标注"方案级 · 非完整备份"。

双端并发与服务端冲突控制（S1 工作包 C）：冲突契约为业务码 `VERSION_CONFLICT` + HTTP 409 + 当前权威版本 `current_updated_at`，网页 / 小程序 / 后端一致。服务端**不**依赖客户端"先 GET 再 PUT"：所有写入入口（行程、方案管理、时间表、地点、费用、类别、路线、通用地点）都先做版本预检，再用 `store.updateIfMatches` 把"版本检查 + 写入"合并为一次**条件更新**（LocalStore 单进程原子；CloudStore 用数据库单文档条件更新，`stats.updated === 0` 即冲突，**不用进程内锁冒充多实例安全**）。旧客户端不带基线时退回"服务端刚读到的版本"，效果是先写者生效、后写者 409，而非后写静默覆盖。网页各域写入携带 `baseUpdatedAt`，各域串行且以后一域以前一域返回的新版本为基线；小程序请求层保留 `status`/`code`，冲突时由用户显式选择"重新加载（丢弃本地）"或"保留本地（不覆盖云端）"，不自动合并含义不明的冲突。

移动端重命名弹窗由 mobile/trip-rename 管理 DOM、紧凑布局、名称空值提示、错误清除及显式触发按钮焦点恢复；mobile/plans 注入 getName/onRename，继续转交既有 mobile:triprename 事件。弹窗不读取 state、账号或保存服务，不改变名称 trim、maxlength、未变化不提交的规则；共享 compact-form-dialog 只提供布局，不包含业务条件。

费用账本的可编辑状态由 runtime/editors 注入，沿用分享模式和当前编辑控件状态，不由 costs/ledger 读取账号、网络或持久化内部信息。账本在展示入口和操作回调中分别检查权限，保留只读查看/导出；服务端鉴权仍为数据写入的最终边界。

账本的旅行/方案上下文同样由编辑协调模块通过 getContext 注入命名字段，账本只负责文本显示与语义标签；费用聚合范围仍为当前 state 中的方案数据，不将方案总额宣称为全部旅行方案的总额。

安排编辑器的上下文展示由 `features/schedule/editor-context.js` 独立负责，runtime/editors 复用同一 getContext 回调提供旅行/方案名称；打开编辑器及日期输入变化时更新文本与可访问描述，不读取网络或保存数据。既有 schedule/editor 仍偏大，路线/交通表单与校验属于后续拆分债务，本次不把上下文渲染继续堆入该文件。

跨日交通上下文通过注入 getArrivalDate 与到达日期输入引用读取当前表单草稿，显示出发/到达两端日期；交通类型切换时刷新，住宿等类型不读取隐藏交通日期。仅是展示，不推断新日期、不改既有校验、迁移和交通模型。

`features/schedule/transport-fields.js` 拥有交通类型/动车字段创建、航班/动车显隐及行内错误显示/清除，输入元素由 editor 注入；只依赖 DOM，不访问网络、存储或 schedule 状态。editor 使用 clearStatus/showError/updateVisibility，继续保留现有校验及保存协调。初始化只装配一次，类型切换复用同一组节点，不建立迁移兼容壳。

交通错误提示放在错误输入所属字段组之后，避免手机“保持焦点字段可见”和错误滚动互相拉扯；使用 preventScroll 聚焦并定位提示，修改输入仍清除错误。浏览器回归同时验证文案、焦点以及提示位于标题/操作栏之间，而非仅检查 DOM 中存在文字。

账本删除通过注入的现有 confirmAction 复用公共确认弹层，不自行创建确认组件；确认前后分别检查可编辑状态，确认后只移除指定独立账目。未注入确认服务时默认拒绝删除，不回退为立即移除。

```text
public/
├── app.js                     # 环境选择与应用入口
├── bootstrap.js               # API、存储、迁移依赖创建
├── core/
│   ├── constants.js
│   ├── state.js               # state 结构与默认值
│   ├── session.js             # load/save、计划快照、数据合并
│   ├── history.js             # undo/redo
│   └── utils.js
├── services/                  # 只处理外部 IO，不访问 DOM
│   ├── api.js
│   ├── geocode.js
│   ├── routing.js
│   └── weather.js
├── features/
│   ├── runtime.js             # 仅作为 composition root
│   ├── runtime/
│   │   ├── commands.js        # 页面命令绑定、委托与统一解绑
│   │   ├── config.js          # 事件语义、预设时间、别名与兼容存储键
│   │   ├── editors.js         # 天气、事件编辑与费用账本协调
│   │   ├── event-inputs.js    # 事件选项、占位文案与旧节点读取适配
│   │   ├── exports.js         # 时间表与地图 PNG 导出装配
│   │   ├── initializer.js     # 缓存、云端、分享数据与首屏渲染协调；读取失败写入门禁
│   │   ├── lifecycle.js       # 地图按需初始化、应用启动、安全重试与统一销毁
│   │   ├── map-state.js       # 地图实例、图层与概览临时状态容器
│   │   ├── mobile-events.js   # 移动 UI 事件到 feature 回调的适配与清理
│   │   ├── places.js          # 地点筛选、多选与拖拽临时状态适配
│   │   ├── routes.js          # 路线模型、共享合并与地图重叠策略适配
│   │   ├── schedule-inputs.js # 时间表鼠标、触屏与交通导入输入适配
│   │   └── workspace.js       # 三栏工作区 DOM 外壳与页面级控件装配
│   ├── plans/
│   │   ├── model.js
│   │   └── dialog.js
│   ├── places/
│   │   ├── model.js
│   │   ├── library.js
│   │   ├── editor.js
│   │   ├── batch-actions.js
│   │   └── drag-drop.js
│   ├── schedule/
│   │   ├── model.js
│   │   ├── view.js
│   │   ├── selection.js
│   │   ├── clipboard.js
│   │   ├── drag-resize.js
│   │   ├── editor.js
│   │   └── focus.js
│   ├── routes/
│   │   ├── model.js
│   │   ├── resolver.js
│   │   ├── editor.js
│   │   └── layer.js
│   ├── map/
│   │   ├── controller.js
│   │   ├── location.js          # 浏览器定位状态与当前位置 Leaflet 图层
│   │   ├── coordinates.js
│   │   ├── geometry.js
│   │   ├── place-layer.js
│   │   ├── route-layer.js
│   │   ├── flight-layer.js
│   │   ├── overview.js
│   │   └── photo-layout.js
│   ├── flights/
│   │   ├── model.js
│   │   ├── importer.js
│   │   └── editor.js
│   ├── costs/
│   ├── weather/
│   │   ├── model.js
│   │   └── controller.js
│   └── export/
│       ├── canvas.js
│       ├── schedule-export.js
│       └── map-export.js
├── storage/
└── styles/
│   ├── tokens.css             # 全局颜色、排版、间距、状态、控件高度、圆角、阴影等设计变量
│   ├── components/            # 跨 feature 复用的 UI 组件样式（反馈、移动弹层表单骨架等）
│   └── mobile/                # 手机端页面与组件覆盖
```

## 依赖规则

```text
runtime → feature controllers → models/services/core
view/editor/layer → model
services → external API
core → no feature imports
```

- model 和纯算法不得访问 DOM、Leaflet 或网络。
- service 不直接读写 UI 和业务 state。
- feature 之间不互相导入 controller；跨 feature 协作由 runtime 注入回调。
- controller 可以修改注入的现有 state，但必须通过 `onChange` 通知持久化和刷新。
- 地图 layer 只管理自身 Leaflet 图层；地图实例生命周期由 map controller 管理。
- 分享版和本地版使用同一 feature，权限差异通过 capability 参数注入。
- 样式依赖方向为 `tokens → shared components → feature/page overrides`；功能样式不得重新定义等价的全局语义色。
- `mobile.css` 是移动样式组合入口；方案、费用、地点、地图、时间表与弹层基础样式均通过真实 `@import` 加载唯一源文件，不得保留同名内联副本。后续页面精修继续放在对应功能文件或明确的页面覆盖层，不再新增迁移期内联功能块。

## Feature 对外接口

每个主要 feature 统一采用工厂接口：

```js
const schedule = createScheduleFeature({
  state,
  elements,
  services,
  capabilities,
  onChange,
  onFocusPlace,
  onFocusRoute
});

schedule.render();
schedule.openEditor(index);
schedule.destroy();
```

不暴露内部临时状态，不依赖 runtime 中的自由变量。

## 最终 runtime 职责

1. 创建 state 和应用级 capability。
2. 创建 session/history 以及各 feature controller。
3. 用回调连接地点、时间表、路线和地图。
4. 执行 `initialize()`，处理顶层错误。
5. 在页面卸载时执行 `destroy()`。

目标规模为 300–600 行。

## 迁移顺序

移动方案入口通过 CustomEvent.detail.opener 传递触发按钮，编辑协调层仅转交，费用与回顾弹窗自行恢复焦点。不依赖鼠标点击是否改变 document.activeElement；费用弹窗转入安排编辑弹窗时不抢走新弹窗焦点。WebKit 回归使用独立配置与隔离测试服务，`npm run test:e2e:webkit` 不改默认 Chromium 套件，也不代表真实 iOS 设备验收。

1. 地点拖放、时间表拖放、天气、导出。
2. 时间表 editor 与 view。
3. 路线 model/resolver/editor。
4. 地图坐标、图层和 overview。
5. session/history/plan dialog。
6. 收敛 runtime 为 composition root。

每一步必须通过语法检查、单元测试、本地版浏览器 smoke test、分享版 smoke test和正式数据哈希校验。

## S2 release ownership

`scripts/release.mjs` composes existing checks and builds a data-free web artifact;
`scripts/release-support.mjs` owns target validation and source/artifact fingerprints.
`scripts/deploy-release.ps1` invokes official deployment tools only for a verified
release. Records stay in ignored `work/releases/`. Production console and device
acceptance are operator-recorded. See `S2-RELEASE.md`; no business dependency points
back to these scripts.

The GitHub `Release gate` workflow calls the same release commands on isolated
Ubuntu runners, archives the tested artifact, and requires no production secrets.
Workflow definitions participate in the source fingerprint. Publishing remains a
separate operator action; the old unchecked `docs` upload is removed.
