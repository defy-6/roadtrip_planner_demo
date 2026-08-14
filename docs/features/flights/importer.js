// 航班导入对话框：批量录入航班并关联机场位置。
export function bindFlightImporter({ $, state, clockToMinute, linkFlightAirports, addItem, renderSchedule, applyDayFilter, save, renderLocations, focusScheduleEvent }) {
  const flightImporter = $('#flightImporter');
  $('#importFlightBtn').onclick = () => {
    $('#flightImportForm').reset();
    $('#flightDate').value = state.dayFilter || state.schedule[0]?.date || new Date().toISOString().slice(0, 10);
    $('#flightArrivalDate').value = $('#flightDate').value;
    flightImporter.showModal();
    requestAnimationFrame(() => $('#flightNumber').focus());
  };
  $('#flightImportCancel').onclick = () => flightImporter.close();
  flightImporter.oncancel = event => { event.preventDefault(); flightImporter.close(); };
  $('#flightImportForm').onsubmit = async event => {
    event.preventDefault();
    const date = $('#flightDate').value, arrivalDate = $('#flightArrivalDate').value, start = $('#flightDepartureTime').value, end = $('#flightArrivalTime').value;
    const flightNumber = $('#flightNumber').value.trim().toUpperCase(), departureAirport = $('#flightDeparture').value.trim(), arrivalAirport = $('#flightArrival').value.trim();
    if (!date || !arrivalDate || !start || !end || !flightNumber || !departureAirport || !arrivalAirport) return;
    if (arrivalDate < date || (arrivalDate === date && clockToMinute(end) <= clockToMinute(start))) { alert('到达日期和时间必须晚于起飞日期和时间。'); return; }
    const departureTerminal = $('#flightDepartureTerminal').value.trim(), arrivalTerminal = $('#flightArrivalTerminal').value.trim(), note = $('#flightNote').value.trim();
    const stopoverAirport = $('#flightStopoverAirport').value.trim(), stopoverArrivalTime = $('#flightStopoverArrivalTime').value, stopoverDepartureTime = $('#flightStopoverDepartureTime').value;
    if (stopoverAirport && (!stopoverArrivalTime || !stopoverDepartureTime)) { alert('填写经停机场后，请同时填写经停到达和再次起飞时间。'); return; }
    const terminalText = [departureTerminal ? `出发 ${departureTerminal}` : '', arrivalTerminal ? `到达 ${arrivalTerminal}` : ''].filter(Boolean).join(' · ');
    const entry = { date, start, end, title: `${flightNumber} ${departureAirport} → ${arrivalAirport}`, detail: [terminalText, note].filter(Boolean).join('；'), address: '', type: 'flight', flightInfo: { flightNumber, departureAirport, arrivalAirport, departureTerminal, arrivalTerminal, arrivalDate, stopoverAirport, stopoverArrivalTime, stopoverDepartureTime, source: 'manual' }, ...(date < '2026-08-20' ? { sharedId: `shared-flight-${crypto.randomUUID()}` } : {}) };
    const submit = event.submitter; if (submit) { submit.disabled = true; submit.textContent = '正在查询机场位置…'; }
    try { await linkFlightAirports(entry); }
    catch (error) { alert(error.message || '暂时无法确认机场位置，请检查机场名称后重试。'); if (submit) { submit.disabled = false; submit.textContent = '确认导入'; } return; }
    const index = state.schedule.length; state.schedule.push(entry);
    addItem({ type: entry.type, date, startTime: start, endTime: end, name: entry.title, address: '', note: entry.detail, scheduleIndex: index });
    save(); renderLocations(); renderSchedule(state.schedule); applyDayFilter(); flightImporter.close(); if (submit) { submit.disabled = false; submit.textContent = '确认导入'; } focusScheduleEvent(index);
  };
  return { flightImporter };
}
