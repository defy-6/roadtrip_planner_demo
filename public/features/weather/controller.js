import { weatherSummary } from './index.js';

export function createWeatherController({ state, $, api, geocode, convertCoords, routeForEvent, getEditingIndex, save, refresh }) {
  async function queryEvent(index, { silent = false } = {}) {
    const event = state.schedule[index]; if (!event) return;
    const editorActive = getEditingIndex() === index && $('#eventEditor').open;
    const eventType = editorActive ? $('#editorType').value : event.type, eventDate = editorActive ? $('#editorDate').value : event.date, eventStart = editorActive ? $('#editorStart').value : event.start, eventEnd = editorActive ? $('#editorEnd').value : event.end;
    const arrivalDate = editorActive ? ($('#editorFlightArrivalDate').value || eventDate) : (event.flightInfo?.arrivalDate || eventDate);
    const button = $('#queryEditorWeather'), status = $('#editorWeatherStatus'); if (button) { button.disabled = true; button.textContent = '查询中…'; }
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
        const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, eventDate, eventEnd || eventStart)]);
        event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '' };
      } else if (eventType === 'flight') {
        const flight = event.flightInfo || {}, departureAirport = editorActive ? $('#editorFlightDeparture').value.trim() : flight.departureAirport, arrivalAirport = editorActive ? $('#editorFlightArrival').value.trim() : flight.arrivalAirport;
        const origin = state.locations.find(place => place.name === departureAirport || place.resolved?.name === departureAirport) || state.locations.find(place => place.id === flight.departurePlaceId) || { name: departureAirport, address: departureAirport };
        const destination = state.locations.find(place => place.name === arrivalAirport || place.resolved?.name === arrivalAirport) || state.locations.find(place => place.id === flight.arrivalPlaceId) || { name: arrivalAirport, address: arrivalAirport };
        const [originWeather, destinationWeather] = await Promise.all([requestWeather(origin, eventDate, eventStart), requestWeather(destination, arrivalDate, eventEnd || eventStart)]);
        event.weather = { origin: originWeather, destination: destinationWeather, eventDate, eventStart: eventStart || '', eventEnd: eventEnd || eventStart || '', arrivalDate, departureAirport, arrivalAirport };
      } else {
        const place = state.locations.find(item => item.id === (editorActive ? $('#eventLocation').value : event.locationId)); const weather = await requestWeather(place, eventDate, eventStart);
        event.weather = { ...weather, placeId: place.id, eventDate, eventStart: eventStart || '' };
      }
      save(); refresh();
      if (status) { status.hidden = false; status.textContent = eventType === 'drive' ? `起点：${weatherSummary(event.weather.origin)}；终点：${weatherSummary(event.weather.destination)}` : eventType === 'flight' ? `起飞：${weatherSummary(event.weather.origin)}；降落：${weatherSummary(event.weather.destination)}` : weatherSummary(event.weather); }
    } catch (error) { if (!silent) alert(error.message || '天气查询失败'); if (silent) throw error; }
    finally { if (button) { button.disabled = false; button.textContent = '重新查询天气'; } }
  }
  async function updateVisible(button) {
    const date = state.dayFilter, targets = state.schedule.map((event, index) => ({ event, index })).filter(({ event }) => !date || event.date === date); if (!targets.length) return;
    const originalText = button?.textContent; if (button) { button.disabled = true; button.textContent = `更新中 0/${targets.length}`; }
    let succeeded = 0; const failed = [];
    for (let index = 0; index < targets.length; index += 1) { const target = targets[index]; try { await queryEvent(target.index, { silent: true }); succeeded += 1; } catch (error) { failed.push(`${target.event.title || '未命名事件'}：${error.message || '无法查询'}`); } if (button) button.textContent = `更新中 ${index + 1}/${targets.length}`; }
    if (button) { button.disabled = false; button.textContent = originalText || '更新卡片天气'; }
    const scope = date || '全部日期'; alert(failed.length ? `${scope}：已更新 ${succeeded} 张卡片；${failed.length} 张未更新（通常是地点尚未确定）。\n${failed.slice(0, 3).join('\n')}` : `${scope}：已更新 ${succeeded} 张卡片天气。`);
  }
  return { queryEvent, updateVisible };
}
