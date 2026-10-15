export function createRuntimeWorkspace({ $, state, getMap, renderSchedule, applyDayFilter }) {
  const locationsPanel = document.createElement('section');
  locationsPanel.className = 'locations-panel';
  locationsPanel.innerHTML = '<div class="aside-head"><h3>当前行程方案地点库 <small id="placeCount"></small></h3><button type="button" id="addPlaceBtn">+ 地点</button></div><p class="hint">仅显示当前行程方案已加入的地点；新建或更新会同步写入账号级“我的地点库”，供本账号的其他行程和方案复用。</p><div class="location-toolbar"><input id="placeSearch" type="search" placeholder="搜索名称、地址或备注"><select id="placeTypeFilter" aria-label="按地点类型筛选"></select><button type="button" id="togglePlaceSelection">选择地点</button><button type="button" id="selectAllPlaces">全选结果</button><button type="button" id="resolveSelectedPlaces">批量查询位置</button><button type="button" id="fetchSelectedPhotos">批量获取图片</button><button type="button" class="danger" id="deleteSelectedPlaces">批量删除</button><button type="button" class="danger" id="cleanupUnusedPlaces">清理未使用地点</button></div><details class="batch-add"><summary>批量新增地点</summary><textarea id="batchPlaceInput" placeholder="每行：类型｜名称｜地址\n例如：地名｜伊宁市｜新疆伊犁州伊宁市"></textarea><div class="batch-actions"><button type="button" id="batchAddPlaces">导入这些地点</button><small>景点、地名、饮食、住宿、机场、服务区、加油站、补给</small></div></details><div id="places" class="places"></div>';
  document.querySelector('.content').insertAdjacentElement('afterend', locationsPanel);

  const schedulePanel = document.querySelector('.schedule-panel');
  const mapWorkspace = document.querySelector('.content');
  const appHeader = document.querySelector('header');
  const compactHero = document.querySelector('.hero');
  appHeader.insertBefore(compactHero, appHeader.querySelector('.top-actions'));
  [schedulePanel, mapWorkspace, locationsPanel].forEach(panel => panel.classList.add('workspace-panel'));

  const createExpandButton = (panel, label) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'panel-expand ghost';
    button.textContent = '放大';
    button.title = `放大${label}`;
    button.onclick = () => {
      const expand = !panel.classList.contains('is-expanded');
      document.querySelectorAll('.workspace-panel').forEach(item => item.classList.remove('is-expanded'));
      document.body.classList.toggle('panel-expanded', expand);
      if (expand) panel.classList.add('is-expanded');
      document.querySelectorAll('.panel-expand').forEach(item => { item.textContent = '放大'; });
      if (expand) button.textContent = '恢复三栏';
      if (panel === schedulePanel) {
        renderSchedule(state.schedule);
        applyDayFilter();
      }
      setTimeout(() => getMap()?.invalidateSize(), 180);
    };
    return button;
  };

  const updateScheduleWeatherButton = document.createElement('button');
  updateScheduleWeatherButton.type = 'button';
  updateScheduleWeatherButton.id = 'updateScheduleWeather';
  updateScheduleWeatherButton.className = 'ghost';
  updateScheduleWeatherButton.textContent = '更新卡片天气';
  updateScheduleWeatherButton.title = '按当前日期筛选批量更新可查询卡片的天气';
  const scheduleActionsContainer = schedulePanel.querySelector('.aside-head>div:last-child');
  scheduleActionsContainer.append(updateScheduleWeatherButton, createExpandButton(schedulePanel, '时间表'));

  const weatherUpdateStatus = document.createElement('p');
  weatherUpdateStatus.id = 'weatherUpdateStatus';
  weatherUpdateStatus.className = 'schedule-feedback';
  weatherUpdateStatus.setAttribute('role', 'status');
  weatherUpdateStatus.setAttribute('aria-live', 'polite');
  weatherUpdateStatus.hidden = true;
  schedulePanel.querySelector('.aside-head').insertAdjacentElement('afterend', weatherUpdateStatus);

  const mapPanel = mapWorkspace.querySelector('.map-panel');
  const mapExpandButton = createExpandButton(mapWorkspace, '地图');
  mapExpandButton.classList.add('map-expand');
  mapPanel.append(mapExpandButton);
  const mapDayControl = document.createElement('label');
  mapDayControl.className = 'map-day-control';
  mapDayControl.innerHTML = '<span>地图日期</span><select id="mapDayFilter" aria-label="地图按天筛选"><option value="">全部日期</option></select>';
  mapPanel.append(mapDayControl);

  const locationActions = document.createElement('div');
  locationActions.className = 'location-head-actions';
  const addPlaceCategoryButton = document.createElement('button');
  addPlaceCategoryButton.type = 'button';
  addPlaceCategoryButton.id = 'addPlaceCategoryBtn';
  addPlaceCategoryButton.className = 'ghost';
  addPlaceCategoryButton.textContent = '+ 类别';
  const addPlaceButton = $('#addPlaceBtn');
  addPlaceButton.before(locationActions);
  locationActions.append(addPlaceCategoryButton, addPlaceButton, createExpandButton(locationsPanel, '地点库'));

  const universalPlaceDialog = $('#universalPlaceDialog');
  universalPlaceDialog.querySelector('h3').textContent = '我的地点库';
  universalPlaceDialog.querySelector('h3').id = 'universalPlaceTitle';
  universalPlaceDialog.setAttribute('aria-labelledby', 'universalPlaceTitle');
  const universalLibraryNote = universalPlaceDialog.querySelector('.hint');
  universalLibraryNote.classList.add('universal-library-note');
  universalLibraryNote.id = 'universalPlaceHint';
  universalPlaceDialog.setAttribute('aria-describedby', 'universalPlaceHint');
  universalLibraryNote.textContent = '账号地点可跨行程复用；协作者看不到这里的私有地点。';
  universalPlaceDialog.querySelector('#universalPlaceSearch').placeholder = '搜索我的地点';
  const placeCategoryEditor = $('#placeCategoryEditor');
  placeCategoryEditor.classList.add('compact-form-dialog');
  placeCategoryEditor.querySelector('h3').id = 'placeCategoryEditorTitle';
  placeCategoryEditor.querySelector('.hint').id = 'placeCategoryEditorHint';
  placeCategoryEditor.setAttribute('aria-labelledby', 'placeCategoryEditorTitle');
  placeCategoryEditor.setAttribute('aria-describedby', 'placeCategoryEditorHint');
  addPlaceCategoryButton.setAttribute('aria-haspopup', 'dialog');
  addPlaceCategoryButton.setAttribute('aria-controls', 'placeCategoryEditor');

  return {
    locationsPanel,
    schedulePanel,
    mapWorkspace,
    mapPanel,
    scheduleActionsContainer,
    updateScheduleWeatherButton,
    weatherUpdateStatus,
    addPlaceButton,
    addPlaceCategoryButton,
    universalPlaceDialog,
    placeCategoryEditor
  };
}
