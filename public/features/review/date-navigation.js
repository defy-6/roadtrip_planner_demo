export function createReviewDateNavigation(dialog) {
  const select = dialog.querySelector('select[data-review-date]');
  const form = dialog.querySelector('.editor-form');
  const jump = (section, { focus = true } = {}) => {
    if (!section) return;
    const heading = section.querySelector('h4');
    select.value = section.dataset.reviewDate;
    if (focus) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    form.scrollTop += heading.getBoundingClientRect().top - dialog.querySelector('.review-header').getBoundingClientRect().bottom - 12;
  };
  select.addEventListener('change', () => {
    const section = [...dialog.querySelectorAll('.review-day')].find(day => day.dataset.reviewDate === select.value);
    jump(section);
  });
  return {
    jump,
    reset() { select.value = ''; },
    update(days) {
      const previous = select.value;
      select.replaceChildren(new Option('跳转日期', ''));
      days.forEach(day => select.add(new Option(day.date || '未设置日期', day.date || 'undated')));
      select.disabled = days.length === 0;
      select.value = [...select.options].some(option => option.value === previous) ? previous : '';
    }
  };
}
