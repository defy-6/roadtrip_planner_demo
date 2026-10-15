// 交通导入对话框：录入航班或动车，并关联机场/车站地点。
import { localToday } from '../../core/utils.js';
export function bindFlightImporter({ $, state, clockToMinute, linkFlightAirports, linkTrainStations, addItem, renderSchedule, applyDayFilter, save, renderLocations, focusScheduleEvent }) {
  const flightImporter = $('#flightImporter');
  const form = $('#flightImportForm');
  const title = flightImporter.querySelector('h3');
  const mainGrid = form.querySelector('.editor-grid');
  const hint = form.querySelector(':scope > .hint');
  const modeField = document.createElement('label');
  flightImporter.classList.add('transport-import-dialog');
  modeField.className = 'transport-mode-field';
  modeField.innerHTML = '交通类型<select id="transportImportMode"><option value="flight">航班</option><option value="train">动车 / 高铁</option></select>';
  mainGrid.before(modeField);
  hint.id = 'transportImportHint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('aria-live', 'polite');
  const status = document.createElement('p');
  status.id = 'transportImportStatus';
  status.className = 'transport-import-status';
  status.setAttribute('role', 'alert');
  status.setAttribute('aria-live', 'assertive');
  status.hidden = true;
  hint.before(status);
  flightImporter.setAttribute('aria-describedby', `${hint.id} ${status.id}`);
  const clearStatus = () => { status.hidden = true; status.textContent = ''; };
  const showError = (message, target) => {
    status.textContent = message;
    status.hidden = false;
    target?.focus();
    status.scrollIntoView({ block: 'nearest' });
  };
  const field = id => $(`#${id}`).closest('label');
  const labels = {
    number: field('flightNumber'), departure: field('flightDeparture'), arrival: field('flightArrival'),
    start: field('flightDepartureTime'), end: field('flightArrivalTime'), arrivalDate: field('flightArrivalDate'),
    departureTerminal: field('flightDepartureTerminal'), arrivalTerminal: field('flightArrivalTerminal'),
    stopover: field('flightStopoverAirport'), stopoverArrival: field('flightStopoverArrivalTime'), stopoverDeparture: field('flightStopoverDepartureTime'),
  };
  [labels.departureTerminal, labels.arrivalTerminal, labels.stopover, labels.stopoverArrival, labels.stopoverDeparture].forEach(label => label?.classList.add('flight-only-field'));
  [field('flightDate'), labels.arrivalDate, labels.start, labels.end, labels.departureTerminal, labels.arrivalTerminal, labels.stopoverArrival, labels.stopoverDeparture].forEach(label => label?.classList.add('transport-half-field'));
  [labels.number, labels.departure, labels.arrival, labels.stopover].forEach(label => label?.classList.add('transport-wide-field'));
  const extraDetails = document.createElement('details');
  extraDetails.className = 'editor-section transport-extra-section';
  extraDetails.innerHTML = '<summary><span>航班补充信息</span><small>航站楼与经停</small></summary><div class="editor-grid"></div>';
  const extraGrid = extraDetails.querySelector('.editor-grid');
  [labels.departureTerminal, labels.arrivalTerminal, labels.stopover, labels.stopoverArrival, labels.stopoverDeparture].forEach(label => extraGrid.append(label));
  mainGrid.after(extraDetails);
  const setLabel = (label, text) => { if (label?.firstChild) label.firstChild.textContent = text; };
  function syncMode() {
    clearStatus();
    const train = $('#transportImportMode').value === 'train';
    flightImporter.classList.toggle('train-import-mode', train);
    extraDetails.hidden = train;
    title.textContent = train ? '导入动车 / 高铁' : '导入航班';
    setLabel(labels.number, train ? '车次' : '航班号'); setLabel(labels.departure, train ? '出发站' : '起飞机场'); setLabel(labels.arrival, train ? '到达站' : '降落机场');
    setLabel(labels.start, train ? '发车时间' : '起飞时间'); setLabel(labels.end, train ? '到站时间' : '到达时间'); setLabel(labels.arrivalDate, train ? '到站日期' : '到达日期');
    [labels.departureTerminal, labels.arrivalTerminal, labels.stopover, labels.stopoverArrival, labels.stopoverDeparture].forEach(label => { label.hidden = train; });
    if (train) ['flightDepartureTerminal', 'flightArrivalTerminal', 'flightStopoverAirport', 'flightStopoverArrivalTime', 'flightStopoverDepartureTime'].forEach(id => { $(`#${id}`).value = ''; });
    $('#flightNumber').placeholder = train ? '例如：G1234 / D3142' : '例如：CZ6825';
    $('#flightDeparture').placeholder = train ? '例如：上海虹桥站' : '例如：广州白云机场';
    $('#flightArrival').placeholder = train ? '例如：杭州东站' : '例如：伊宁机场';
    hint.textContent = train
      ? '导入时会查询并关联出发站、到达站位置；请填写完整车站名称。'
      : '导入时会查询并关联起降机场；航站楼和经停信息可在“航班补充信息”中填写。';
  }
  $('#transportImportMode').onchange = syncMode;
  form.addEventListener('input', clearStatus);
  $('#importFlightBtn').textContent = '导入交通';
  $('#importFlightBtn').onclick = () => {
    $('#flightImportForm').reset();
    $('#flightDate').value = state.dayFilter || localToday();
    $('#flightArrivalDate').value = $('#flightDate').value;
    syncMode(); flightImporter.showModal();
    requestAnimationFrame(() => $('#flightNumber').focus());
  };
  $('#flightImportCancel').onclick = () => flightImporter.close();
  flightImporter.oncancel = event => { event.preventDefault(); flightImporter.close(); };
  $('#flightImportForm').onsubmit = async event => {
    event.preventDefault();
    const date = $('#flightDate').value, arrivalDate = $('#flightArrivalDate').value, start = $('#flightDepartureTime').value, end = $('#flightArrivalTime').value;
    const isTrain = $('#transportImportMode').value === 'train';
    const flightNumber = $('#flightNumber').value.trim().toUpperCase(), departureAirport = $('#flightDeparture').value.trim(), arrivalAirport = $('#flightArrival').value.trim();
    if (!date || !arrivalDate || !start || !end || !flightNumber || !departureAirport || !arrivalAirport) return;
    if (arrivalDate < date || (arrivalDate === date && clockToMinute(end) <= clockToMinute(start))) {
      showError(`${isTrain ? '到站' : '到达'}日期和时间必须晚于${isTrain ? '发车' : '起飞'}日期和时间。`, arrivalDate < date ? $('#flightArrivalDate') : $('#flightArrivalTime'));
      return;
    }
    const departureTerminal = $('#flightDepartureTerminal').value.trim(), arrivalTerminal = $('#flightArrivalTerminal').value.trim(), note = $('#flightNote').value.trim();
    const stopoverAirport = $('#flightStopoverAirport').value.trim(), stopoverArrivalTime = $('#flightStopoverArrivalTime').value, stopoverDepartureTime = $('#flightStopoverDepartureTime').value;
    if (!isTrain && stopoverAirport && (!stopoverArrivalTime || !stopoverDepartureTime)) {
      extraDetails.open = true;
      showError('填写经停机场后，请同时填写经停到达和再次起飞时间。', !stopoverArrivalTime ? $('#flightStopoverArrivalTime') : $('#flightStopoverDepartureTime'));
      return;
    }
    const terminalText = [departureTerminal ? `出发 ${departureTerminal}` : '', arrivalTerminal ? `到达 ${arrivalTerminal}` : ''].filter(Boolean).join(' · ');
    const entry = isTrain
      ? { date, start, end, title: `${flightNumber} ${departureAirport} → ${arrivalAirport}`, detail: note, address: '', type: 'transport', transportInfo: { kind: 'train', trainNumber: flightNumber, departureStation: departureAirport, arrivalStation: arrivalAirport, arrivalDate, source: 'manual' } }
      : { date, start, end, title: `${flightNumber} ${departureAirport} → ${arrivalAirport}`, detail: [terminalText, note].filter(Boolean).join('；'), address: '', type: 'transport', transportInfo: { kind: 'flight', number: flightNumber, departureName: departureAirport, arrivalName: arrivalAirport, arrivalDate, source: 'manual' }, flightInfo: { flightNumber, departureAirport, arrivalAirport, departureTerminal, arrivalTerminal, arrivalDate, stopoverAirport, stopoverArrivalTime, stopoverDepartureTime, source: 'manual' }, ...(date < '2026-08-20' ? { sharedId: `shared-flight-${crypto.randomUUID()}` } : {}) };
    const submit = event.submitter; if (submit) { submit.disabled = true; submit.textContent = isTrain ? '正在导入…' : '正在查询机场位置…'; }
    try {
      if (isTrain) await linkTrainStations(entry);
      else await linkFlightAirports(entry);
    } catch (error) {
      showError(error.message || `暂时无法确认${isTrain ? '车站' : '机场'}位置，请检查名称后重试。`, $('#flightDeparture'));
      if (submit) { submit.disabled = false; submit.textContent = '确认导入'; }
      return;
    }
    const index = state.schedule.length; state.schedule.push(entry);
    addItem({ type: entry.type, date, startTime: start, endTime: end, name: entry.title, address: '', note: entry.detail, scheduleIndex: index });
    save(); renderLocations(); renderSchedule(state.schedule); applyDayFilter(); flightImporter.close(); if (submit) { submit.disabled = false; submit.textContent = '确认导入'; } focusScheduleEvent(index);
  };
  return { flightImporter };
}
