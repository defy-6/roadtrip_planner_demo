// Transport form UI only. Validation and persistence remain in the editor.
export function createTransportFields({ flightFields, dateFields }) {
  const document = flightFields.ownerDocument;
  const kindField = document.createElement('label');
  kindField.id = 'editorTransportKindField';
  kindField.innerHTML = '交通信息<select id="editorTransportKind"><option value="other">普通交通</option><option value="flight">航班</option><option value="train">动车 / 高铁</option></select>';
  flightFields.before(kindField);
  const trainFields = document.createElement('div');
  trainFields.id = 'trainFields';
  trainFields.className = 'editor-grid';
  trainFields.hidden = true;
  trainFields.innerHTML = '<label>车次<input id="editorTrainNumber" placeholder="例如：G1234"></label><label>到站日期<input id="editorTrainArrivalDate" type="date"></label><label>出发站<input id="editorTrainDeparture" placeholder="例如：上海虹桥站"></label><label>到达站<input id="editorTrainArrival" placeholder="例如：杭州东站"></label>';
  flightFields.insertAdjacentElement('afterend', trainFields);
  const status = document.createElement('p');
  status.id = 'editorTransportStatus';
  status.className = 'editor-transport-status';
  status.setAttribute('role', 'alert');
  status.setAttribute('aria-live', 'assertive');
  status.hidden = true;
  trainFields.insertAdjacentElement('afterend', status);
  const clearStatus = () => { status.hidden = true; status.textContent = ''; };
  const showError = (message, target) => {
    status.textContent = message;
    status.hidden = false;
    // Keep the message beside the invalid field group, so the mobile focused-field
    // scrolling and error scrolling do not pull the form in opposite directions.
    const group = target?.closest('.editor-grid') || target?.closest('label');
    group?.after(status);
    target?.focus({ preventScroll: true });
    status.scrollIntoView({ block: 'center', behavior: 'instant' });
  };
  for (const node of [flightFields, trainFields, ...dateFields]) node?.addEventListener('input', clearStatus);
  const updateVisibility = ({ type, kind }) => {
    const isTransport = type === 'transport';
    const isFlight = isTransport && kind === 'flight';
    const isTrain = isTransport && kind === 'train';
    flightFields.hidden = !isFlight;
    trainFields.hidden = !isTrain;
    kindField.hidden = !isTransport;
    if (!isFlight && !isTrain) clearStatus();
    return { isFlight, isTrain };
  };
  return { clearStatus, showError, updateVisibility };
}
