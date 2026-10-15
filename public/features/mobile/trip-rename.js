// Feature-local dialog UI; reading and committing names stay with the caller.
export function createTripRenameDialog({ getName, onRename }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'tripRenameDialog';
  dialog.className = 'event-editor trip-rename-dialog compact-form-dialog';
  dialog.setAttribute('aria-labelledby', 'tripRenameTitle');
  dialog.setAttribute('aria-describedby', 'tripRenameHint');
  dialog.innerHTML = '<form class="editor-form" method="dialog"><h3 id="tripRenameTitle">重命名行程</h3><p id="tripRenameHint" class="hint">修改行程空间名称；各行程方案名称不会改变。</p><label for="tripRenameName">行程名称<input id="tripRenameName" required maxlength="60" autocomplete="off" aria-describedby="tripRenameHint tripRenameError"></label><p id="tripRenameError" role="alert" hidden></p><div class="editor-actions"><button type="button" class="ghost" data-triprename-cancel>取消</button><button type="submit">保存名称</button></div></form>';
  document.body.append(dialog);
  const input = dialog.querySelector('#tripRenameName');
  const error = dialog.querySelector('#tripRenameError');
  let opener = null;
  const clearError = () => {
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    error.textContent = '';
  };
  const showError = () => {
    input.setCustomValidity('请输入行程名称');
    input.setAttribute('aria-invalid', 'true');
    error.textContent = '请输入行程名称';
    error.hidden = false;
    input.focus();
  };
  input.addEventListener('input', clearError);
  input.addEventListener('invalid', event => { event.preventDefault(); showError(); });
  dialog.querySelector('[data-triprename-cancel]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    if (opener?.isConnected && !document.querySelector('dialog[open]')) opener.focus({ preventScroll: true });
  });
  dialog.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    if (!name) { showError(); return; }
    clearError();
    const changed = name !== (getName() || '').trim();
    dialog.close();
    if (changed) onRename(name);
  });
  return { open(button) {
    if (dialog.open) return;
    opener = button;
    clearError();
    input.value = getName() || '';
    dialog.showModal();
    input.focus();
    input.select();
  } };
}
