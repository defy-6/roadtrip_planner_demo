# Roadtrip Planner 目标架构

## 目标

`runtime.js` 最终只负责创建共享状态、装配 feature、连接跨 feature 事件以及启动/销毁应用，不再包含业务算法、DOM 模板和具体交互实现。继续沿用原生 ES Modules、当前 `state` 对象、JSON 数据格式和现有部署方式。

## 目录结构

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
└── storage/
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

1. 地点拖放、时间表拖放、天气、导出。
2. 时间表 editor 与 view。
3. 路线 model/resolver/editor。
4. 地图坐标、图层和 overview。
5. session/history/plan dialog。
6. 收敛 runtime 为 composition root。

每一步必须通过语法检查、单元测试、本地版浏览器 smoke test、分享版 smoke test和正式数据哈希校验。
