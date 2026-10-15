import { weatherSummary } from './index.js';

export function createWeatherController({ state, $, api, geocode, convertCoords, routeForEvent, linkFlightAirports, linkTrainStations, getEditingIndex, save, refresh, batchStatus }) {
  const announceBatch = (message, tone = 'info') => {
    if (!batchStatus) return;
    batchStatus.textContent = message;
    batchStatus.dataset.tone = tone;
    batchStatus.hidden = false;
  };
  const clockMinute = value => {
    const [hour, minute] = String(value || '').split(':').map(Number);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  };
  const shiftedDateTime = (date, minute) => {
    minute = Math.round(minute);
    const dayOffset = Math.floor(minute / 1440);
    const normalized = ((minute % 1440) + 1440) % 1440;
    const nextDate = new Date(`${date}T12:00:00`);
    nextDate.setDate(nextDate.getDate() + dayOffset);
    return {
      date: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`,
      time: `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
    };
  };
  const eventDuration = (start, end) => {
    const startMinute = clockMinute(start), rawEndMinute = clockMinute(end);
    if (startMinute === null || rawEndMinute === null) return null;
    return (rawEndMinute < startMinute ? rawEndMinute + 1440 : rawEndMinute) - startMinute;
  };
  async function queryEvent(index, { silent = false } = {}) {
    const event = state.schedule[index]; if (!event) return;
    const editorActive = getEditingIndex() === index && $('#eventEditor').open;
    const eventType = editorActive ? $('#editorType').value : event.type, eventDate = editorActive ? $('#editorDate').value : event.date, eventStart = editorActive ? $('#editorStart').value : event.start, eventEnd = editorActive ? $('#editorEnd').value : event.end;
    const transportKind = editorActive ? $('#editorTransportKind')?.value : event.transportInfo?.kind;
    const isFlight = eventType === 'flight' || (eventType === 'transport' && transportKind === 'flight');
    const isTrain = eventType === 'transport' && transportKind === 'train';
    const arrivalDate = editorActive
      ? ((isTrain ? $('#editorTrainArrivalDate')?.value : $('#editorFlightArrivalDate')?.value) || eventDate)
      : ((isTrain ? event.transportInfo?.arrivalDate : event.flightInfo?.arrivalDate) || eventDate);
    const button = $('#queryEditorWeather'), status = $('#editorWeatherStatus');
    if (button) { button.disabled = true; button.textContent = '查询中…'; }
    if (!silent && status) { status.hidden = false; status.textContent = '正在查询当前安排的天气…'; status.dataset.tone = 'info'; }
    try {
      const requestWeather = async (place, date, time) => {
        if (!place?.address) throw new Error('请先关联或填写具有明确地址的地点。');
        let point = place.resolved?.location;
        if (!point) { const result = await geocode(place.address, place.name); point = result.location; if (place.id) place.resolved = { name: result.name || place.name, address: result.formatted_address || place.address, location: point }; }
        const [longitude, latitude] = convertCoords(...point.split(',').map(Number));
        return api.getWeather({ latitude, longitude, date, time: time || '12:00' });
      };
      if (eventType === 'drive') {
        const route = routeForEvent(event), links = route ? { ...event.routeLinks, ...route } : event.routeLinks || {};
        const origin = (editorActive && ($('#routeOrigin').value ? state.locations.find(place => place.id === $('#routeOrigin').value) : { name: $('#routeOriginName').value.trim(), address: $('#routeOriginAddress').value.trim() })) || state.locations.find(place => place.id === links.originPlaceId) || links.customOrigin;
        const destination = (editorActive && ($('#routeDestination').value ? state.locations.find(place => place.id === $('#routeDestination').value) : { name: $('#routeDestinationName').value.trim(), address: $('#routeDestinationAddress').value.trim() })) || state.locations.find(place => place.id === links.destinationPlaceId) || links.customDestination;
        const startMinute = clockMinute(eventStart), rawEndMinute = clockMinute(eventEnd);
        const endMinute = startMinute !== null && rawEndMinute !== null && rawEndMinute < startMinute ? rawEndMinute + 1440 : rawEndMinute;
        const duration = startMinute !== null && endMinute !== null ? endMinute - startMinute : null;
        if (duration !== null && duration >= 0 && duration <= 60) {
          const resolveWeatherPoint = async place => {
            if (!place?.address) throw new Error('请先关联或填写具有明确地址的地点。');
            let point = place.resolved?.location;
            if (!point) {
              const result = await geocode(place.address, place.name);
              point = result.location;
              if (place.id) place.resolved = { name: result.name || place.name, address: result.formatted_address || place.address, location: point };
            }
            return convertCoords(...point.split(',').map(Number));
          };
          const [originPoint, destinationPoint] = await Promise.all([resolveWeatherPoint(origin), resolveWeatherPoint(destination)]);
          const midpoint = [(originPoint[0] + destinationPoint[0]) / 2, (originPoint[1] + destinationPoint[1]) / 2];
          const midpointDateTime = shiftedDateTime(eventDate, startMinute + duration / 2);
          const midpointWeather = await api.getWeather({ latitude: midpoint[1], longitude: midpoint[0], date: midpointDateTime.date, time: midpointDateTime.time });
          event.weather = { midpoint: midpointWeather, midpointDate: midpointDateTime.date, midpointTime: midpointDateTime.time, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '' };
        } else {
          const destinationDateTime = shiftedDateTime(eventDate, endMinute ?? startMinute ?? 0);
          const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, destinationDateTime.date, eventEnd || eventStart)]);
          event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '' };
        }
      } else if (isFlight) {
        const flight = event.flightInfo || {}, departureAirport = editorActive ? $('#editorFlightDeparture').value.trim() : flight.departureAirport, arrivalAirport = editorActive ? $('#editorFlightArrival').value.trim() : flight.arrivalAirport;
        // 旧航班只有机场名称而没有地点 ID。更新天气时先补建并关联机场，
        // 避免统一为 transport 类型后误走普通地点天气分支。编辑器尚未保存的
        // 机场名称不会写入地点库；名称未修改时则可以安全修复旧关联。
        const editorUsesSavedAirports = !editorActive || (departureAirport === flight.departureAirport && arrivalAirport === flight.arrivalAirport);
        if (editorUsesSavedAirports && linkFlightAirports && (!flight.departurePlaceId || !flight.arrivalPlaceId)) await linkFlightAirports(event);
        const origin = state.locations.find(place => place.id === flight.departurePlaceId) || state.locations.find(place => place.name === departureAirport || place.resolved?.name === departureAirport) || { name: departureAirport, address: departureAirport };
        const destination = state.locations.find(place => place.id === flight.arrivalPlaceId) || state.locations.find(place => place.name === arrivalAirport || place.resolved?.name === arrivalAirport) || { name: arrivalAirport, address: arrivalAirport };
        const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, arrivalDate, eventEnd || eventStart)]);
        event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '', arrivalDate, departureAirport, arrivalAirport };
      } else if (isTrain) {
        const train = event.transportInfo || {};
        const departureStation = editorActive ? $('#editorTrainDeparture').value.trim() : train.departureStation;
        const arrivalStation = editorActive ? $('#editorTrainArrival').value.trim() : train.arrivalStation;
        const editorUsesSavedStations = !editorActive || (departureStation === train.departureStation && arrivalStation === train.arrivalStation);
        if (editorUsesSavedStations && linkTrainStations && (!train.departurePlaceId || !train.arrivalPlaceId)) await linkTrainStations(event);
        const origin = state.locations.find(place => place.id === train.departurePlaceId) || state.locations.find(place => place.name === departureStation || place.resolved?.name === departureStation) || { name: departureStation, address: departureStation };
        const destination = state.locations.find(place => place.id === train.arrivalPlaceId) || state.locations.find(place => place.name === arrivalStation || place.resolved?.name === arrivalStation) || { name: arrivalStation, address: arrivalStation };
        const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, arrivalDate, eventEnd || eventStart)]);
        event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '', arrivalDate, departureStation, arrivalStation };
      } else {
        const place = state.locations.find(item => item.id === (editorActive ? $('#eventLocation').value : event.locationId));
        const duration = eventDuration(eventStart, eventEnd);
        if (duration !== null && duration > 60) {
          const endDateTime = shiftedDateTime(eventDate, (clockMinute(eventStart) || 0) + duration);
          const [originWeather, destinationWeather] = await Promise.all([
            requestWeather(place, eventDate, eventStart),
            requestWeather(place, endDateTime.date, eventEnd || eventStart)
          ]);
          event.weather = { origin: originWeather, destination: destinationWeather, placeId: place.id, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '', endDate: endDateTime.date };
        } else {
          const weather = await requestWeather(place, eventDate, eventStart);
          event.weather = { ...weather, placeId: place.id, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '' };
        }
      }
      save(); refresh();
      if (status) { status.hidden = false; status.dataset.tone = 'success'; status.textContent = eventType === 'drive' ? (event.weather.midpoint ? `路程中点：${weatherSummary(event.weather.midpoint)}` : `起点：${weatherSummary(event.weather.origin)}；终点：${weatherSummary(event.weather.destination)}`) : isFlight ? `起飞：${weatherSummary(event.weather.origin)}；降落：${weatherSummary(event.weather.destination)}` : isTrain ? `出发：${weatherSummary(event.weather.origin)}；到达：${weatherSummary(event.weather.destination)}` : event.weather.origin || event.weather.destination ? `开始：${weatherSummary(event.weather.origin)}；结束：${weatherSummary(event.weather.destination)}` : weatherSummary(event.weather); }
    } catch (error) {
      if (silent) throw error;
      if (status) {
        status.hidden = false;
        status.dataset.tone = 'error';
        status.textContent = error.message || '天气查询失败';
      }
      const target = eventType === 'drive' ? ($('#routeOriginSearch') || $('#routeOriginName'))
        : isFlight ? $('#editorFlightDeparture')
        : isTrain ? $('#editorTrainDeparture')
        : $('#resolveEditorPlace');
      target?.focus?.();
      status?.scrollIntoView?.({ block: 'center' });
    }
    finally { if (button) { button.disabled = false; button.textContent = '重新查询天气'; } }
  }
  async function updateVisible(button) {
    const date = state.dayFilter, targets = state.schedule.map((event, index) => ({ event, index })).filter(({ event }) => !date || event.date === date); if (!targets.length) { announceBatch('当前筛选范围内没有可更新的事件。', 'warning'); return; }
    const originalText = button?.textContent; if (button) { button.disabled = true; button.textContent = `更新中 0/${targets.length}`; }
    let succeeded = 0; const failed = [];
    for (let index = 0; index < targets.length; index += 1) { const target = targets[index]; try { await queryEvent(target.index, { silent: true }); succeeded += 1; } catch (error) { failed.push(`${target.event.title || '未命名事件'}：${error.message || '无法查询'}`); } if (button) button.textContent = `更新中 ${index + 1}/${targets.length}`; }
    if (button) { button.disabled = false; button.textContent = originalText || '更新卡片天气'; }
    const scope = date || '全部日期';
    announceBatch(
      failed.length
        ? `${scope}：已更新 ${succeeded} 张卡片，${failed.length} 张未更新。${failed.slice(0, 3).join('；')}`
        : `${scope}：已更新 ${succeeded} 张卡片天气。`,
      failed.length ? 'warning' : 'success'
    );
  }
  return { queryEvent, updateVisible };
}
