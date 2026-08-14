export function createMobileMap(workspace) {
  const panel = workspace?.querySelector('.map-panel');
  if (!panel || panel.querySelector('.mobile-map-tools')) return;
  const tools = document.createElement('div'); tools.className = 'mobile-map-tools';
  tools.innerHTML = '<button type="button" data-map-action="layers">▱<small>图层</small></button><button type="button" data-map-action="fit">⌗<small>全览</small></button><button type="button" data-map-action="locate">➤<small>定位</small></button>';
  tools.addEventListener('click', event => { const action = event.target.closest('button')?.dataset.mapAction; if (action) window.dispatchEvent(new CustomEvent('mobile:mapaction', { detail: { action } })); });
  window.addEventListener('mobile:maplayerchanged', event => { const label = event.detail?.label; if (label) tools.querySelector('[data-map-action="layers"] small').textContent = label; });
  panel.append(tools);
  const legendToggle = document.createElement('button');
  legendToggle.type = 'button'; legendToggle.className = 'mobile-map-legend-toggle'; legendToggle.textContent = '图例';
  legendToggle.setAttribute('aria-expanded', 'false');
  legendToggle.onclick = () => {
    const expanded = panel.classList.toggle('show-mobile-legend');
    legendToggle.setAttribute('aria-expanded', String(expanded));
    legendToggle.textContent = expanded ? '收起图例' : '图例';
  };
  panel.querySelector('#map')?.append(legendToggle);
  panel.querySelector('#map')?.addEventListener('pointerup', event => {
    const route = event.target.closest?.('.map-overview-route,.map-route-hit'); if (!route) return;
    window.dispatchEvent(new CustomEvent('mobile:routefocus', { detail: { index: Number(route.dataset.scheduleIndex) } }));
  });
  const nativeFilter = panel.querySelector('#mapDayFilter');
  nativeFilter?.addEventListener('change', () => { const dayFilter = document.querySelector('#dayFilter'); dayFilter.value = nativeFilter.value; dayFilter.dispatchEvent(new Event('change', { bubbles: true })); });
  const stats = document.createElement('section'); stats.className = 'mobile-map-summary';
  stats.innerHTML = '<header><h3 data-map-summary-title>全程路线</h3><button type="button" data-map-summary-toggle aria-expanded="false">查看详情 ›</button></header><div class="mobile-map-metrics"><span><b data-map-stat="distance">—</b><small data-map-label="distance">总里程</small></span><span><b data-map-stat="duration">—</b><small data-map-label="duration">预计用时</small></span><span><b data-map-stat="segments">—</b><small data-map-label="segments">已确认路段</small></span><span><b data-map-stat="weather">—</b><small data-map-label="weather">天气</small></span></div><div class="mobile-map-detail"></div>';
  panel.append(stats);
  stats.querySelector('[data-map-summary-toggle]').onclick = event => { const expanded = stats.classList.toggle('show-detail'); event.currentTarget.setAttribute('aria-expanded', String(expanded)); event.currentTarget.textContent = expanded ? '收起详情⌃' : '查看详情 ›'; };
  const update = () => {
    const distanceText = document.querySelector('#distance')?.textContent || '';
    const routeDetail = document.querySelector('#routeDetail');
    const detailText = routeDetail?.textContent.replace(/\s+/g, ' ').trim() || '';
    const selectedTitle = routeDetail?.querySelector('.detail-title')?.textContent.trim() || '';
    const isSelectedRoute = Boolean(selectedTitle && /公里/.test(detailText) && /(自驾|步行|骑行|公共交通|公交)/.test(detailText));
    const date = panel.querySelector('#mapDayFilter')?.value || '';
    if (isSelectedRoute) {
      stats.querySelector('[data-map-summary-title]').textContent = selectedTitle;
      stats.querySelector('[data-map-stat="distance"]').textContent = detailText.match(/[\d.]+\s*公里/)?.[0]?.replace(/\s+/g, '') || '—';
      stats.querySelector('[data-map-stat="duration"]').textContent = routeDetail.dataset.routeDuration || detailText.match(/(?:\d+小时\s*)?\d+分钟/)?.[0]?.replace(/\s+/g, '') || '—';
      const toll = detailText.match(/过路费约?\s*([\d.]+)\s*元/)?.[1];
      stats.querySelector('[data-map-stat="segments"]').textContent = toll == null ? '—' : `¥${toll}`;
      stats.querySelector('[data-map-stat="weather"]').textContent = routeDetail.dataset.routeWeather || '未查询';
      stats.querySelector('[data-map-label="distance"]').textContent = '路线里程';
      stats.querySelector('[data-map-label="duration"]').textContent = '路线用时';
      stats.querySelector('[data-map-label="segments"]').textContent = '过路费';
      stats.querySelector('[data-map-label="weather"]').textContent = '天气';
    } else {
      stats.querySelector('[data-map-summary-title]').textContent = date ? `${date} 路线` : '全程路线';
      stats.querySelector('[data-map-stat="distance"]').textContent = distanceText.match(/[\d.]+\s*公里/)?.[0]?.replace(/\s+/g, '') || '—';
      stats.querySelector('[data-map-stat="duration"]').textContent = document.querySelector('#duration')?.textContent || '—';
      stats.querySelector('[data-map-stat="segments"]').textContent = distanceText.match(/\d+\/\d+(?=\s*段已确认)/)?.[0] || distanceText.match(/\d+(?=\s*段路程)/)?.[0] || '—';
      stats.querySelector('[data-map-stat="weather"]').textContent = '—';
      stats.querySelector('[data-map-label="distance"]').textContent = '总里程';
      stats.querySelector('[data-map-label="duration"]').textContent = '预计用时';
      stats.querySelector('[data-map-label="segments"]').textContent = '已确认路段';
      stats.querySelector('[data-map-label="weather"]').textContent = '天气';
    }
    const mobileDetail = stats.querySelector('.mobile-map-detail');
    if (isSelectedRoute) {
      const meta = routeDetail.querySelector('.detail-meta')?.cloneNode(true);
      const note = routeDetail.querySelector('.detail-note')?.cloneNode(true);
      const source = routeDetail.querySelector('.detail-source')?.cloneNode(true);
      const modeText = routeDetail.querySelector('.detail-key')?.textContent.replace(/\s*·\s*[\d.]+\s*公里.*$/, '').trim();
      const mode = modeText ? document.createElement('strong') : null;
      if (mode) { mode.className = 'detail-key'; mode.textContent = modeText; }
      mobileDetail.replaceChildren(...[meta, mode, note, source].filter(Boolean));
    } else mobileDetail.innerHTML = routeDetail?.innerHTML || '<small>点击地图地点或路线查看详细信息。</small>';
  };
  new MutationObserver(update).observe(document.querySelector('#routeDetail'), { childList: true, subtree: true }); update();
  nativeFilter?.addEventListener('change', update);
}
