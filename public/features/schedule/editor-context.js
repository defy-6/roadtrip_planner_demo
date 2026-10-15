// Display-only context. Trip/plan ownership stays in the runtime composition layer.
export function createScheduleEditorContext({ dialog, dateInput, getContext, getArrivalDate = () => '', arrivalDateInputs = [] }) {
  const heading = dialog.querySelector('h3');
  const context = document.createElement('p');
  context.id = 'scheduleEditorContext';
  context.className = 'schedule-editor-context';
  heading.after(context);
  heading.id ||= 'scheduleEditorTitle';
  dialog.setAttribute('aria-labelledby', heading.id);
  const descriptions = new Set((dialog.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  descriptions.add(context.id);
  dialog.setAttribute('aria-describedby', [...descriptions].join(' '));
  const render = () => {
    const { tripName, planName } = getContext();
    const arrivalDate = getArrivalDate();
    const dateLabel = `${dateInput.value || '未设置日期'}${arrivalDate && arrivalDate !== dateInput.value ? ` → ${arrivalDate}（到达）` : ''}`;
    context.textContent = [
      tripName ? `所属行程：${tripName}` : '',
      planName ? `当前方案：${planName}` : '',
      `安排日期：${dateLabel}`
    ].filter(Boolean).join('\n');
  };
  for (const input of [dateInput, ...arrivalDateInputs]) {
    input.addEventListener('input', render);
    input.addEventListener('change', render);
  }
  return { render };
}
