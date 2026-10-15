export function createConfirmationDialog() {
  const dialog = document.createElement('dialog');
  dialog.className = 'event-editor compact-form-dialog action-confirm-dialog';
  dialog.setAttribute('aria-labelledby', 'actionConfirmTitle');
  dialog.setAttribute('aria-describedby', 'actionConfirmMessage actionConfirmDetail');
  dialog.innerHTML = `
    <section class="editor-form">
      <div class="action-confirm-heading">
        <span class="action-confirm-icon" aria-hidden="true">!</span>
        <div>
          <p class="eyebrow">请确认此操作</p>
          <h3 id="actionConfirmTitle"></h3>
        </div>
      </div>
      <p id="actionConfirmMessage" class="action-confirm-message"></p>
      <p id="actionConfirmDetail" class="action-confirm-detail"></p>
      <div class="editor-actions">
        <button type="button" class="ghost" data-confirm-cancel>取消</button>
        <button type="button" class="danger" data-confirm-submit>确认删除</button>
      </div>
    </section>`;
  document.body.append(dialog);

  const title = dialog.querySelector('#actionConfirmTitle');
  const message = dialog.querySelector('#actionConfirmMessage');
  const detail = dialog.querySelector('#actionConfirmDetail');
  const cancelButton = dialog.querySelector('[data-confirm-cancel]');
  const submitButton = dialog.querySelector('[data-confirm-submit]');
  let settle = null;

  function finish(result) {
    if (!settle) return;
    const resolve = settle;
    settle = null;
    if (dialog.open) dialog.close();
    resolve(result);
  }

  cancelButton.addEventListener('click', () => finish(false));
  submitButton.addEventListener('click', () => finish(true));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
  dialog.addEventListener('close', () => finish(false));

  function confirmAction({ title: heading, message: prompt, detail: supportingText = '', confirmLabel = '确认删除' }) {
    if (settle) finish(false);
    title.textContent = heading;
    message.textContent = prompt;
    detail.textContent = supportingText;
    detail.hidden = !supportingText;
    submitButton.textContent = confirmLabel;
    dialog.showModal();
    requestAnimationFrame(() => cancelButton.focus());
    return new Promise(resolve => { settle = resolve; });
  }

  return { confirmAction };
}
