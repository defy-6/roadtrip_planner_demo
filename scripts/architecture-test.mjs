import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [index, styleCss, tokensCss, feedbackCss, mobileFormControlsCss, mapCss, placesCss, placeComponentsCss, plansCss, accountingCss, scheduleCss, timelineCardsCss, transportDialogCss, accountDialogCss, exportPreviewCss, placeEditorDialogCss, placeDropDialogCss, placeCategoryDialogCss, planDialogCss, actionConfirmDialogCss, placeSearchResultsCss, dialogsCss, navigationCss, headerCss, shellCss, foundationCss, runtimeCss, mobileCss, mobileShell, runtime, app, bootstrap, persistence] = await Promise.all([
  readFile('public/index.html', 'utf8'),
  readFile('public/style.css', 'utf8'),
  readFile('public/styles/tokens.css', 'utf8'),
  readFile('public/styles/components/feedback.css', 'utf8'),
  readFile('public/styles/components/mobile-form-controls.css', 'utf8'),
  readFile('public/styles/mobile/map.css', 'utf8'),
  readFile('public/styles/mobile/places.css', 'utf8'),
  readFile('public/styles/mobile/place-components.css', 'utf8'),
  readFile('public/styles/mobile/plans.css', 'utf8'),
  readFile('public/styles/mobile/accounting.css', 'utf8'),
  readFile('public/styles/mobile/schedule.css', 'utf8'),
  readFile('public/styles/mobile/timeline-cards.css', 'utf8'),
  readFile('public/styles/mobile/transport-dialog.css', 'utf8'),
  readFile('public/styles/mobile/account-dialog.css', 'utf8'),
  readFile('public/styles/mobile/export-preview.css', 'utf8'),
  readFile('public/styles/mobile/place-editor-dialog.css', 'utf8'),
  readFile('public/styles/mobile/place-drop-dialog.css', 'utf8'),
  readFile('public/styles/mobile/place-category-dialog.css', 'utf8'),
  readFile('public/styles/mobile/plan-dialog.css', 'utf8'),
  readFile('public/styles/mobile/action-confirm-dialog.css', 'utf8'),
  readFile('public/styles/mobile/place-search-results.css', 'utf8'),
  readFile('public/styles/mobile/dialogs.css', 'utf8'),
  readFile('public/styles/mobile/navigation.css', 'utf8'),
  readFile('public/styles/mobile/header.css', 'utf8'),
  readFile('public/styles/mobile/shell.css', 'utf8'),
  readFile('public/styles/mobile/foundation.css', 'utf8'),
  readFile('public/runtime.css', 'utf8'),
  readFile('public/mobile.css', 'utf8'),
  readFile('public/features/mobile/shell.js', 'utf8'),
  readFile('public/features/runtime.js', 'utf8'),
  readFile('public/app.js', 'utf8'),
  readFile('public/bootstrap.js', 'utf8'),
  readFile('public/storage/persistence.js', 'utf8')
]);

assert.match(index, /<link rel="stylesheet" href="\/runtime\.css(?:\?[^\"]*)?">/);
assert.match(styleCss, /@import '\.\/styles\/tokens\.css'/, '基础样式入口必须先加载 Design Tokens');
assert.match(styleCss, /@import '\.\/styles\/components\/feedback\.css'/, '基础样式入口必须加载公共反馈组件');
assert.match(tokensCss, /--ui-status-error-bg:/, 'Design Tokens 必须拥有状态语义色');
for (const token of ['control-height-touch', 'action-height-touch', 'radius-control', 'radius-surface', 'radius-sheet']) {
  assert.match(tokensCss, new RegExp(`--ui-${token}:`), `Design Tokens 必须拥有 ${token}`);
}
for (const token of ['title', 'section-title', 'body', 'meta', 'label', 'leading-title', 'leading-section', 'leading-body']) {
  assert.match(tokensCss, new RegExp(`--ui-${token}:`), `Design Tokens 必须拥有排版变量 ${token}`);
}
for (const token of ['space-1', 'space-2', 'space-3', 'space-4', 'space-5']) {
  assert.match(tokensCss, new RegExp(`--ui-${token}:`), `Design Tokens 必须拥有间距变量 ${token}`);
}
for (const token of ['green', 'green-hover', 'green-soft', 'ink', 'muted', 'line', 'canvas', 'surface', 'danger', 'shadow']) {
  assert.match(tokensCss, new RegExp(`--ui-${token}:`), `Design Tokens 必须拥有主题变量 ${token}`);
  assert.doesNotMatch(mobileCss, new RegExp(`--ui-${token}:`), `mobile.css 不得重新声明主题变量 ${token}`);
}
for (const localTypographyToken of ['title', 'section-title', 'body', 'meta', 'label']) {
  assert.doesNotMatch(mobileCss, new RegExp(`html\\[data-preview-mode="mobile"\\]\\{[^}]*--ui-${localTypographyToken}:`), `mobile.css 不得重新声明全局排版变量 ${localTypographyToken}`);
}
for (const legacyToken of ['control', 'action', 'radius-sm', 'radius-md', 'radius-lg']) {
  assert.doesNotMatch(mobileCss, new RegExp(`--ui-${legacyToken}(?:\\s*:|\\))`), `mobile.css 不得重新维护旧尺寸变量 ${legacyToken}`);
}
assert.match(feedbackCss, /\.save-toast[\s\S]*?\.inline-operation-status/, '全局与内联反馈必须由公共组件样式拥有');
assert.doesNotMatch(runtimeCss, /^\.save-toast\s*\{/m, 'runtime.css 不得重新拥有公共反馈组件');
for (const selector of ['place-query-status', 'editor-location-status', 'editorWeatherStatus', 'place-batch-status', 'schedule-feedback', 'transport-import-status', 'editor-transport-status']) {
  assert.match(feedbackCss, new RegExp(selector), `${selector} 必须由公共反馈组件样式拥有`);
  assert.doesNotMatch(runtimeCss, new RegExp(`\\.${selector}\\s*\\{|#${selector}\\s*\\{`), `${selector} 不得回流到 runtime.css`);
}
for (const token of ['info', 'success', 'warning', 'error']) {
  assert.match(feedbackCss, new RegExp(`--ui-status-${token}-`), `公共反馈组件必须使用 ${token} 语义 token`);
}
const mobileFormControlsImport = "@import './styles/components/mobile-form-controls.css'";
const mobileDialogOverridesImport = "@import './styles/mobile/transport-dialog.css'";
assert.match(mobileCss, new RegExp(mobileFormControlsImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'mobile.css 必须加载移动表单公共组件');
assert.ok(mobileCss.indexOf(mobileFormControlsImport) < mobileCss.indexOf(mobileDialogOverridesImport), '公共表单组件必须先于功能弹层覆盖加载');
for (const selector of ['dialog[open]', 'dialog .editor-form', 'dialog .editor-actions']) {
  assert.ok(mobileFormControlsCss.includes(selector), `公共表单组件必须拥有 ${selector}`);
}
assert.doesNotMatch(mobileCss, /^html\[data-preview-mode="mobile"\] dialog\[open\]\{/m, 'mobile.css 不得重新拥有移动弹层外壳');
assert.doesNotMatch(mobileCss, /^html\[data-preview-mode="mobile"\] dialog \.editor-form\{/m, 'mobile.css 不得重新拥有移动弹层表单骨架');
assert.doesNotMatch(mobileCss, /^html\[data-preview-mode="mobile"\] dialog \.editor-actions\{/m, 'mobile.css 不得重新拥有移动弹层操作栏');
assert.match(exportPreviewCss, /\.map-export-preview\[open\]\s*\{[^}]*width:\s*min\(calc\(100vw - 20px\),410px\)/s, '导出预览组件必须拥有移动预览外壳');
assert.match(exportPreviewCss, /\.map-export-preview img\s*\{[^}]*max-height:\s*min\(68dvh,calc\(88dvh - 228px\)\)/s, '导出预览组件必须限制图片高度并保留操作区');
assert.match(transportDialogCss, /#flightImporter\.transport-import-dialog/, '交通导入模块必须拥有自身弹层');
assert.match(transportDialogCss, /\.transport-extra-section\[hidden\]/, '交通导入模块必须拥有可选字段显隐状态');
assert.match(accountDialogCss, /#accountDialog\.is-account-auth/, '账号模块必须拥有登录短弹层');
assert.match(accountDialogCss, /#accountDialog\.is-account-auth #accSkip\s*\{\s*grid-column:\s*1\s*\/\s*-1/, '窄屏本地模式入口必须独占整行，不能被认证按钮裁切');
assert.match(accountDialogCss, /#accountDialog \.account-member/, '账号模块必须拥有协作者控件布局');
assert.match(placeEditorDialogCss, /#placeEditor \.place-event-associations,[\s\S]*?width:\s*100%\s*!important/, '地点编辑模块必须限制关联区在内容宽度内');
assert.match(placeEditorDialogCss, /#placeEditor \.editor-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s, '地点编辑模块必须拥有贴合短屏底部的粘性操作栏');
assert.match(placeDropDialogCss, /#placeDropEditor \.editor-actions button\s*\{[^}]*white-space:\s*nowrap/s, '地点关联弹层必须拥有三按钮防裁切契约');
assert.match(placeDropDialogCss, /\.place-drop-dialog \.hint\s*\{[^}]*background:\s*var\(--ui-green-soft\)/s, '地点关联弹层必须拥有提示表面');
assert.match(placeCategoryDialogCss, /#placeCategoryEditor input\[type="color"\]\s*\{[^}]*height:\s*44px/s, '地点类别弹层必须拥有颜色控件触控高度');
assert.match(planDialogCss, /#planDialog\.is-danger-mode #planDialogSubmit\s*\{[^}]*background:\s*var\(--ui-danger\)/s, '方案弹层必须拥有删除危险态');
assert.match(actionConfirmDialogCss, /\.action-confirm-dialog\s*\{[^}]*max-width:\s*420px/s, '共享确认弹层必须拥有移动安全宽度');
assert.match(actionConfirmDialogCss, /\[data-confirm-submit\]\s*\{[^}]*background:\s*var\(--ui-danger\)/s, '共享确认弹层必须拥有危险提交态');
assert.doesNotMatch(mobileCss, /#(?:placeEditor|universalPlaceDialog|flightImporter|tripRenameDialog|accountDialog|placeDropEditor|placeCategoryEditor|planDialog)|\.account-dialog|\.place-drop-dialog|\.action-confirm-dialog|\.map-export-preview/, 'mobile.css 不得重新拥有二级弹层组件样式');
assert.doesNotMatch(index, /<link rel="stylesheet" href="\/mobile\.css(?:\?[^\"]*)?">/, '桌面 HTML 壳不得静态加载手机样式');
assert.match(bootstrap, /preview\.mode === 'mobile'/, '手机样式只能在手机预览模式加载');
assert.match(bootstrap, /stylesheet\.href = '\.\/mobile\.css/, '手机模式应动态加载独立 mobile.css');
assert.match(bootstrap, /runtime\.shareMode[\s\S]*?mode: 'mobile'/, 'GitHub Pages 只读分享页应强制复用手机模式');
assert.match(bootstrap, /defaultCloudApiBase[\s\S]*?configuredApiBase/, '正式 Web 应默认连接腾讯云开发 HTTP 网关');
assert.match(bootstrap, /get\('cloud'\) === '1'/, 'localhost 手机预览应支持显式连接腾讯云联调');
assert.match(index, /<dialog id="mapExportPreview"/);
assert.match(index, /<dialog id="placeEditor"/);
assert.match(index, /<dialog id="planDialog"/);
assert.match(runtimeCss, /Runtime presentation rules/);
assert.match(shellCss, /Mobile shell only/);
assert.match(foundationCss, /Shared mobile foundations/);
for (const stylesheet of ['timeline-cards', 'plan-components', 'plans', 'accounting', 'places', 'place-components', 'map', 'map-components', 'transport-dialog', 'account-dialog', 'export-preview', 'place-editor-dialog', 'place-drop-dialog', 'place-category-dialog', 'plan-dialog', 'action-confirm-dialog', 'place-search-results', 'schedule', 'dialogs', 'navigation', 'header', 'shell', 'foundation']) {
  assert.match(mobileCss, new RegExp(`^@import './styles/mobile/${stylesheet}\\.css';$`, 'm'), `mobile.css 必须真实导入 ${stylesheet}.css`);
}
assert.match(shellCss, /body\[data-mobile-view="schedule"\] \.schedule-panel\s*\{\s*display:\s*block/, '移动壳层必须拥有主视图路由');
assert.match(foundationCss, /--mobile-control-height:\s*44px/, '移动基础层必须拥有统一触控高度别名');
assert.match(mobileFormControlsCss, /\[hidden\]\[hidden\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s, '公共移动表单必须拥有应用状态隐藏契约');
assert.match(mobileFormControlsCss, /\.editor-form\s*\{[^}]*scroll-padding-bottom:\s*100px[^}]*overscroll-behavior:\s*contain/s, '公共移动表单必须拥有操作栏滚动留白');
assert.match(foundationCss, /\.save-toast\[data-tone="error"\]/, '移动基础层必须拥有保存提示语义色');
assert.doesNotMatch(mobileCss, /dialog-components\.css/, '已拆空的通用弹层模块不得重新进入移动入口');
assert.match(foundationCss, /prefers-reduced-motion:\s*reduce/, '移动基础层必须保留减少动效适配');
assert.doesNotMatch(mobileCss, /html\[data-preview-mode="mobile"\]\s*(?:\{|body|main|:where|:is)/, 'mobile.css 只能组合样式模块，不得重新拥有具体规则');
assert.ok(mobileCss.indexOf("@import './styles/mobile/map-components.css'") < mobileCss.indexOf("@import './styles/mobile/map.css'"), '地图唯一源文件必须保持迁移前的最终层叠顺序');
assert.match(mapCss, /body\[data-mobile-view="map"\] \.map-panel\s*\{[^}]*grid-template-rows:\s*minmax\(0,1fr\) auto/s, '地图页面样式必须拥有地图与摘要的最终行布局');
assert.match(mapCss, /\.mobile-map-network-status\.is-error/, '地图页面样式必须拥有定位网络错误状态');
assert.doesNotMatch(mobileCss, /\.mobile-map-(?:tools|summary|network-status|legend-toggle)|\.map-(?:day-control|export-control|empty)|#map \.leaflet-|\.route-map-delete|#routeError:not/, 'mobile.css 不得重新拥有地图组件、控件或状态样式');
assert.match(placeComponentsCss, /--place-card-image-width:\s*clamp\(96px,\s*6rem,\s*108px\)/, '地点卡组件必须拥有原版紧凑图片列变量');
assert.match(placeComponentsCss, /--place-card-detail-height:\s*max\(calc\(2\.375rem - 1px\),\s*calc\(6\.875rem - 72px\)\)/, '地点卡组件必须只在大字体下扩展详情区');
assert.match(placeComponentsCss, /--place-card-height:\s*calc\([^;]*var\(--place-card-detail-height\)/, '地点卡组件高度必须由共享行变量推导');
assert.match(placeComponentsCss, /grid-template-columns:\s*var\(--place-card-image-width\)/, '地点卡网格必须消费共享图片列变量');
assert.match(placeComponentsCss, /grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+var\(--place-card-action-height\)/, '地点卡组件必须让单行标题释放空间给详情区');
assert.doesNotMatch(placeComponentsCss, /grid-template-columns:\s*96px|min-height:\s*170px|Natural-height cards/, '地点卡组件不得重新引入旧自然高度基线');
assert.match(placeComponentsCss, /content:\s*'图片加载失败'/, '地点卡组件必须拥有图片失败状态');
assert.doesNotMatch(placesCss, /\.place-card-summary\s*(?:,|\{)|\.place-photo-preview|\.mobile-place-meta|\.mobile-place-actions/, 'places.css 只能拥有地点页面布局，不能重新拥有共享地点卡组件');
assert.doesNotMatch(mobileCss, /\.cleanup-unused-|\.mobile-place-selection-actions|\.place-batch-status/, 'mobile.css 不得重新拥有地点页批量操作与清理弹层');
assert.doesNotMatch(mobileCss, /\.mobile-place-tabs|\.mobile-segmented|\.mobile-category-chips|\.location-toolbar/, 'mobile.css 不得重新拥有地点页筛选与搜索控件');
assert.match(placesCss, /body\[data-mobile-view="places"\] \.locations-panel\s*\{[^}]*height:\s*calc\(100dvh - 184px\)[^}]*overflow:\s*hidden/s, '地点页样式必须拥有页面滚动外壳');
assert.match(placeSearchResultsCss, /\.place-search-results\s*\{[^}]*position:\s*fixed[^}]*z-index:\s*3200/s, '地点搜索组件必须拥有固定浮层与层级');
assert.doesNotMatch(mobileCss, /body\[data-mobile-view="places"\] \.locations-panel(?:\s*>|\s*\{)|\.place-search-results?|\.mobile-place-filter|\.mobile-place-meta|\.place-grid:empty|#items:empty/, 'mobile.css 不得重新拥有地点页面布局、卡片元信息或搜索浮层样式');
assert.match(scheduleCss, /\.mobile-view-switch\s*\{[^}]*height:\s*40px[^}]*border:\s*1px solid var\(--mobile-line\)/s, '时间表样式必须拥有紧凑视图切换契约');
assert.doesNotMatch(mobileCss, /\.mobile-view-switch/, 'mobile.css 不得重新拥有时间表视图切换器');
assert.match(dialogsCss, /#eventEditor\s*\{[^}]*box-shadow:/s, '移动弹层样式必须拥有事件编辑器外壳');
assert.match(dialogsCss, /#eventEditor\s+\.editor-price-line\s*\{[^}]*grid-template-columns:/s, '移动弹层样式必须拥有事件费用行布局');
assert.equal((dialogsCss.match(/#eventEditor \.mobile-editor-types\{/g) || []).length, 1, '事件类型选择外壳必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.mobile-editor-types button\{/g) || []).length, 1, '事件类型按钮必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.mobile-editor-types button\.is-selected\{/g) || []).length, 1, '事件类型选中态必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.mobile-editor-summary\{/g) || []).length, 1, '事件摘要外壳必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.mobile-editor-summary>div\{/g) || []).length, 1, '事件摘要项必须只有一个最终规则块');
assert.match(dialogsCss, /#eventEditor \.mobile-editor-summary\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important/s, '事件摘要必须保持当前三列紧凑布局');
assert.equal((dialogsCss.match(/#eventEditor \.editor-form>\.editor-grid:first-of-type\{/g) || []).length, 1, '事件首行网格必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-form>\.editor-grid:first-of-type>label\{/g) || []).length, 1, '事件首行控件必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-form>\.editor-grid:first-of-type>label input\{/g) || []).length, 1, '事件首行输入必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-section\{/g) || []).length, 1, '事件折叠区外壳必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-section summary\{/g) || []).length, 1, '事件折叠区标题必须只有一个最终规则块');
assert.match(dialogsCss, /#eventEditor \.editor-section\{[^}]*overflow:hidden!important[^}]*border:1px solid var\(--mobile-line\)!important/s, '事件折叠区必须保持裁切与边框契约');
assert.equal((dialogsCss.match(/#eventEditor \.editor-actions\{/g) || []).length, 1, '事件底部操作栏必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-actions button\{/g) || []).length, 1, '事件底部操作按钮必须只有一个最终规则块');
assert.match(dialogsCss, /#eventEditor \.editor-actions\{[^}]*position:fixed!important[^}]*grid-auto-columns:minmax\(0,1fr\)!important[^}]*padding:10px 14px calc\(10px \+ env\(safe-area-inset-bottom\)\)!important/s, '事件操作栏必须保持固定等分与安全区契约');
assert.equal((dialogsCss.match(/#eventEditor\{/g) || []).length, 1, '事件编辑器外壳必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-form\{/g) || []).length, 1, '事件编辑器滚动表单必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor \.editor-form h3\{/g) || []).length, 1, '事件编辑器标题必须只有一个最终规则块');
assert.match(dialogsCss, /#eventEditor\{[^}]*height:min\(90dvh,760px\)!important[^}]*box-shadow:0 -12px 38px/s, '事件编辑器必须保持紧凑底部抽屉外壳');
assert.equal((dialogsCss.match(/#eventEditor \.editor-section\[open\]>:not\(summary\)\{/g) || []).length, 1, '事件展开内容必须只有一个最终规则块');
assert.equal((dialogsCss.match(/#eventEditor label\{/g) || []).length, 1, '事件通用标签必须只有一个最终规则块');
assert.match(dialogsCss, /#eventEditor\s+\.editor-location-status\s*\{[^}]*width:\s*100%/s, '移动弹层样式必须拥有事件地点反馈布局');
assert.match(dialogsCss, /#eventEditor\s+#editorWeatherStatus\s*\{[^}]*margin:\s*0 0 var\(--ui-space-2\)/s, '移动弹层样式必须拥有事件天气反馈布局');
assert.match(dialogsCss, /\.event-editor\.compact-form-dialog\s*\{[^}]*height:\s*fit-content/s, '移动弹层样式必须拥有事件紧凑确认态');
assert.doesNotMatch(mobileCss, /#eventEditor|\.event-editor|\.mobile-editor-(?:types|summary)/, 'mobile.css 不得重新拥有事件编辑弹层');
assert.match(navigationCss, /\.mobile-tabbar\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)[^}]*height:\s*78px/s, '移动导航必须拥有四等分悬浮布局');
assert.match(navigationCss, /\.mobile-tabbar\s+a\s*\{[^}]*height:\s*64px/s, '移动导航必须拥有完整触控高度');
assert.doesNotMatch(mobileCss, /\.mobile-tabbar/, 'mobile.css 不得重新拥有底部导航组件');
assert.match(headerCss, /body\[data-mobile-view\]\s+\.app-header\s*\{[^}]*height:\s*76px[^}]*min-height:\s*76px/s, '移动页头必须拥有统一紧凑高度');
assert.match(headerCss, /body\[data-mobile-view\]\.mobile-header-collapsed\s+\.app-header\s*\{[^}]*height:\s*calc\(62px[^}]*min-height:\s*calc\(62px/s, '时间表滚动页头必须真正收起');
assert.doesNotMatch(headerCss, /每日时间表|行程地图|地点库|行程方案/, '移动页头不得重新引入冗长的双套页面标题');
assert.doesNotMatch(mobileCss, /\.app-header|\.brand-lockup/, 'mobile.css 不得重新拥有顶部页头组件');
assert.match(plansCss, /\.mobile-plans-panel\s+\.mobile-action-card\s+button\s*\{[^}]*height:\s*44px/s, '方案页面必须拥有紧凑命令按钮契约');
assert.doesNotMatch(plansCss, /html\[data-preview-mode="mobile"\]\s+\.mobile-action-card(?:\s|,|\{)/, '方案卡片规则必须限定在方案页面作用域');
assert.doesNotMatch(mobileCss, /\.mobile-plans-panel|\.mobile-current-plan|\.mobile-plan-list/, 'mobile.css 不得重新拥有方案页面布局');
assert.match(accountingCss, /\.expense-row:has\(button\.is-danger\)\s*\{[^}]*grid-template-columns:[^}]*44px 44px/s, '费用账本样式必须拥有双操作触控列契约');
assert.match(accountingCss, /\.expense-ledger \.editor-form>h3\s*\{[^}]*position:\s*sticky/s, '费用账本样式必须拥有粘性上下文标题；具体滚动几何由浏览器回归验证');
assert.doesNotMatch(mobileCss, /\.expense-(?:ledger|ledger-toolbar|row|category|day|entry)|data-ledger-total/, 'mobile.css 不得重新拥有费用账本样式');
assert.match(scheduleCss, /\.mobile-date-strip\s*>\s*\.mobile-timeline-controls\s*\{[^}]*height:\s*38px/s, '时间表样式必须拥有紧凑日期工具栏契约');
assert.match(scheduleCss, /\.mobile-weather-background-btn\s*\{[^}]*width:\s*34px/s, '时间表样式必须拥有紧凑天气按钮契约');
assert.doesNotMatch(mobileCss, /\.mobile-(?:timeline-controls|timeline-date|weather-background-btn|all-dates-btn|multiselect-btn|select-done|select-toggle-row|select-count)/, 'mobile.css 不得重新拥有时间表日期工具栏');
assert.match(scheduleCss, /body\[data-mobile-view="schedule"\] #addScheduleBtn\s*\{[^}]*height:\s*52px[^}]*border-radius:\s*999px/s, '时间表样式必须拥有移动主操作按钮');
assert.match(scheduleCss, /\.aside-head>div:last-child>button:not\(#addScheduleBtn\)[^\{]*\{display:\s*none/, '时间表样式必须隐藏已迁移到方案页的旧导出按钮');
assert.match(scheduleCss, /\.schedule-panel\.mobile-list-view \.calendar-grid\s*\{[^}]*display:\s*block/s, '时间表样式必须拥有列表模式页面布局');
assert.match(timelineCardsCss, /body\.mobile-multiselect \.calendar-block\.batch-selected/, '时间线卡片必须拥有多选反馈状态');
assert.doesNotMatch(mobileCss, /\.mobile-date-strip|\.mobile-weekdays|\.calendar-(?:grid|corner|head|day|block)|\.time-rail|#(?:dayFilter|addScheduleBtn|importFlightBtn|updateScheduleWeather)|\.schedule-(?:scroll|feedback|touch-dragging)|\.mobile-schedule-skeleton/, 'mobile.css 不得重新拥有时间表页面或卡片样式');
assert.match(timelineCardsCss, /\.calendar-block\s*>\s*\.weather-badge\s*\{[^}]*top:\s*5px[^}]*right:\s*7px/s, '时间线卡片必须拥有天气右上角契约');
assert.match(timelineCardsCss, /\.weather-badge-paired\s*\{[^}]*bottom:\s*5px/s, '时间线卡片必须拥有双天气右下角契约');
assert.doesNotMatch(mobileCss, /\.calendar-block(?:\.has-weather)?\s*>?\s*\.weather-badge|\.calendar-block\.has-weather/, 'mobile.css 不得重新拥有事件天气角位');
assert.doesNotMatch(mobileCss, /\.place-card-summary\s*(?:,|\{)/, 'mobile.css 不得重新拥有地点卡外壳');
assert.doesNotMatch(mobileCss, /\.place-photo-preview/, 'mobile.css 不得重新拥有地点卡图片几何');
assert.doesNotMatch(mobileCss, /\.mobile-place-actions/, 'mobile.css 不得重新拥有地点卡操作栏');
assert.match(mapCss, /\.map-export-control\{[^}]*position:absolute!important/, '地图导出按钮在忙碌状态下也必须保持悬浮定位');
assert.doesNotMatch(mobileCss, /:where\(\.is-loading,\[aria-busy="true"\]\)\{[^}]*position:/, '公共忙碌状态不得改写组件布局定位');
assert.doesNotMatch(mobileCss, /内联 \.\/styles\/mobile\/plans\.css/, '行程方案样式不得以内联副本回流 mobile.css');
assert.doesNotMatch(mobileCss, /内联 \.\/styles\/mobile\/accounting\.css/, '费用账本样式不得以内联副本回流 mobile.css');
assert.doesNotMatch(mobileCss, /内联 \.\/styles\/mobile\/places\.css/, '地点页样式不得以内联副本回流 mobile.css');
assert.doesNotMatch(mobileCss, /内联 \.\/styles\/mobile\/map\.css/, '地图页样式不得以内联副本回流 mobile.css');
assert.doesNotMatch(mobileCss, /内联 \.\/styles\/mobile\/schedule\.css/, '时间表样式不得以内联副本回流 mobile.css');
assert.doesNotMatch(mobileCss, /内联 \.\/styles\/mobile\/dialogs\.css/, '移动弹层样式不得以内联副本回流 mobile.css');
for (const feature of ['schedule', 'map', 'places', 'plans', 'dialogs']) {
  assert.match(mobileShell, new RegExp(`\\./${feature}\\.js`));
}
assert.doesNotMatch(runtime, /document\.createElement\('dialog'\)/);
assert.doesNotMatch(runtime, /document\.head\.append\(Object\.assign\(document\.createElement\('style'\)/);
assert.match(runtime, /createRuntimeWorkspace\(/, 'runtime 必须通过工作区模块装配页面外壳');
assert.doesNotMatch(runtime, /const locationsPanel = document\.createElement\('section'\)/, 'runtime 不得重新拥有地点工作区 DOM 模板');
assert.match(runtime, /createPlannerInitializer\(/, 'runtime 必须通过初始化协调器连接缓存、云端与首屏渲染');
assert.doesNotMatch(runtime, /async function initializePlanner\(/, 'runtime 不得重新拥有初始化数据流程');
assert.match(runtime, /bindMobileEvents:\s*bindRuntimeMobileEvents/, 'runtime 必须把移动事件桥接模块注入生命周期协调器');
assert.doesNotMatch(runtime, /window\.addEventListener\('mobile:viewchange'/, 'runtime 不得重新内联移动视图事件监听');
assert.match(runtime, /from '\.\/runtime\/config\.js'/, 'runtime 必须从独立配置模块读取预设与识别规则');
assert.doesNotMatch(runtime, /const presetNodeTimes = \{/, 'runtime 不得重新内联预设时间数据');
assert.match(runtime, /bindRuntimeCommands\(/, 'runtime 必须通过命令适配器连接页面命令');
assert.doesNotMatch(runtime, /document\.querySelector\('#exportBtn'\)\.onclick/, 'runtime 不得重新内联导出命令');
assert.match(runtime, /configureRuntimeEventInputs\(/, 'runtime 必须通过事件输入适配器配置选项并读取旧节点');
assert.doesNotMatch(runtime, /\$\('#editorType'\)\.append\(new Option/, 'runtime 不得重新内联事件类型选项装配');
assert.doesNotMatch(runtime, /function values\(/, 'runtime 不得重新内联旧事件节点读取逻辑');
assert.match(runtime, /startRuntimeLifecycle\(/, 'runtime 必须通过生命周期协调器启动并清理应用');
assert.doesNotMatch(runtime, /window\.addEventListener\('pagehide'/, 'runtime 不得重新内联页面卸载清理');
assert.doesNotMatch(runtime, /let mapReadyPromise/, 'runtime 不得重新拥有地图按需初始化状态');
assert.match(runtime, /createRuntimePlaces\(/, 'runtime 必须通过地点运行时适配器管理地点 UI 临时状态');
for (const declaration of ['placeSearchText', 'placeSelectionMode', 'draggingPlaceId', 'clearPlaceDragTimer']) {
  assert.doesNotMatch(runtime, new RegExp(`(?:let|const) ${declaration}`), `runtime 不得重新拥有地点临时状态 ${declaration}`);
}
assert.match(runtime, /createRuntimeRoutes\(/, 'runtime 必须通过路线运行时适配器装配路线模型与地图重叠策略');
assert.doesNotMatch(runtime, /routeVisualOverlapPolicy/, 'runtime 不得重新内联路线视觉重叠策略');
assert.doesNotMatch(runtime, /createRouteModel\(/, 'runtime 不得重新直接创建路线模型');
assert.match(runtime, /createRuntimeMapState\(/, 'runtime 必须通过地图状态容器连接地图 feature');
for (const declaration of ['routeLayer', 'markerLayer', 'dayOverviewLayer', 'dayPhotoCalloutLayer', 'dayOverviewRequestId', 'mapFocusDate', 'renderedOverviewDate']) {
  assert.doesNotMatch(runtime, new RegExp(`let ${declaration}`), `runtime 不得重新直接拥有地图状态 ${declaration}`);
}
assert.match(runtime, /bindRuntimeExports\(/, 'runtime 必须通过导出适配器连接地图和时间表导出');
assert.doesNotMatch(runtime, /bindScheduleExport\(/, 'runtime 不得重新直接绑定时间表导出');
assert.doesNotMatch(runtime, /bindMapExport\(/, 'runtime 不得重新直接绑定地图导出');
assert.match(runtime, /createRuntimeEditors\(/, 'runtime 必须通过编辑器套件连接天气、事件和费用编辑');
assert.doesNotMatch(runtime, /createWeatherController\(/, 'runtime 不得重新直接创建天气控制器');
assert.doesNotMatch(runtime, /createScheduleEditor\(/, 'runtime 不得重新直接创建事件编辑器');
assert.doesNotMatch(runtime, /createExpenseLedger\(/, 'runtime 不得重新直接创建费用账本');
assert.match(runtime, /bindRuntimeScheduleInputs\(/, 'runtime 必须通过时间表输入适配器绑定鼠标、触屏与交通导入');
assert.doesNotMatch(runtime, /bindScheduleDragDrop\(/, 'runtime 不得重新直接绑定时间表鼠标拖放');
assert.doesNotMatch(runtime, /bindScheduleTouchDrag\(/, 'runtime 不得重新直接绑定时间表触屏拖动');
assert.doesNotMatch(runtime, /bindFlightImporter\(/, 'runtime 不得重新直接绑定交通导入');
assert.match(app, /import '\.\/bootstrap\.js(?:\?[^']*)?'/);
assert.match(bootstrap, /startRuntime\(/);
assert.match(persistence, /enableAutoSave/);
assert.doesNotMatch(runtime, /(?:localStorage|fetch\()/);

const buildScript = await readFile('scripts/build-share.mjs', 'utf8');
assert.match(buildScript, /app\\\.js\(\[\^\\\"\]\*\)/, '共享构建应兼容 app.js 的缓存查询参数');
assert.match(buildScript, /share-config\.js/, '共享构建必须注入 share-config.js');

console.log('Architecture test passed: static shells and runtime presentation assets are wired.');
