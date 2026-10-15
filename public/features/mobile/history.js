import { mobileIcon } from './icons.js';

export function createMobileHistoryAction(nav) {
  const source = document.querySelector('#undoBtn');
  if (!nav || !source || document.querySelector('.mobile-undo-action')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mobile-undo-action';
  button.innerHTML = mobileIcon('undo');
  button.setAttribute('aria-label', '撤销上一步操作');
  button.title = '撤销上一步操作';
  button.onclick = () => source.click();
  const sync = () => {
    button.disabled = source.disabled;
    button.setAttribute('aria-disabled', String(source.disabled));
  };
  new MutationObserver(sync).observe(source, { attributes: true, attributeFilter: ['disabled'] });
  sync();
  document.querySelector('.app-header').append(button);
}
