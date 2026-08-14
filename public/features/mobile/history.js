export function createMobileHistoryAction(nav) {
  const source = document.querySelector('#undoBtn');
  if (!nav || !source || nav.querySelector('.mobile-undo-action')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mobile-undo-action';
  button.innerHTML = '<span aria-hidden="true">↶</span>撤销';
  button.title = '撤销上一步操作';
  button.onclick = () => source.click();
  const sync = () => {
    button.disabled = source.disabled;
    button.setAttribute('aria-disabled', String(source.disabled));
  };
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['disabled'] });
  sync();
  nav.append(button);
}
