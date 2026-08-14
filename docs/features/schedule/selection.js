export function bindScheduleMarquee({ schedule, enabled, selectedIndexes, onSuppressClick, onSelectionChange }) {
  if (!schedule) return;
  schedule.classList.toggle('schedule-selecting', enabled);
  onSelectionChange();
  if (!enabled) return;
  let startX = 0;
  let startY = 0;
  let marquee = null;
  let selecting = false;
  const finish = () => {
    if (!selecting) return;
    selecting = false;
    marquee?.remove();
    marquee = null;
    onSelectionChange();
  };
  schedule.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest('button,select,input') || event.target.closest('.calendar-block')) return;
    event.preventDefault();
    selecting = true;
    startX = event.clientX;
    startY = event.clientY;
    if (!event.shiftKey) selectedIndexes.clear();
    marquee = document.createElement('div');
    marquee.className = 'calendar-marquee';
    document.body.append(marquee);
    const update = move => {
      if (!selecting) return;
      const left = Math.min(startX, move.clientX);
      const top = Math.min(startY, move.clientY);
      const width = Math.abs(move.clientX - startX);
      const height = Math.abs(move.clientY - startY);
      if (width > 4 || height > 4) onSuppressClick();
      Object.assign(marquee.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      const box = { left, top, right: left + width, bottom: top + height };
      schedule.querySelectorAll('.calendar-block').forEach(block => {
        const rect = block.getBoundingClientRect();
        if (rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top) selectedIndexes.add(Number(block.dataset.scheduleIndex));
      });
      schedule.querySelectorAll('.calendar-block').forEach(block => block.classList.toggle('batch-selected', selectedIndexes.has(Number(block.dataset.scheduleIndex))));
      onSelectionChange();
    };
    const up = () => {
      window.removeEventListener('pointermove', update);
      window.removeEventListener('pointerup', up);
      finish();
    };
    window.addEventListener('pointermove', update);
    window.addEventListener('pointerup', up);
  };
}
