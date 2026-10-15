export function createReviewPhotoPreview({ getContext = () => ({}) } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = 'event-editor review-photo-dialog';
  dialog.setAttribute('aria-labelledby', 'reviewPhotoTitle');
  dialog.setAttribute('aria-describedby', 'reviewPhotoContext');
  dialog.innerHTML = '<section class="editor-form"><h3 id="reviewPhotoTitle">地点图片</h3><p id="reviewPhotoContext" class="review-photo-context"></p><p class="hint" role="status" data-photo-status></p><img data-photo-preview alt=""><div class="editor-actions"><button type="button" class="ghost" data-photo-close>返回回顾</button></div></section>';
  document.body.append(dialog);
  const image = dialog.querySelector('[data-photo-preview]');
  const status = dialog.querySelector('[data-photo-status]');
  let opener = null;
  image.addEventListener('load', () => { status.textContent = ''; status.hidden = true; });
  image.addEventListener('error', () => { image.hidden = true; status.hidden = false; status.textContent = '图片加载失败，请返回回顾后重试。'; });
  dialog.querySelector('[data-photo-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    image.removeAttribute('src');
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  return {
    open(button) {
      const thumbnail = button.querySelector('img');
      if (!thumbnail || dialog.open) return;
      opener = button;
      image.hidden = false;
      image.alt = thumbnail.alt;
      dialog.querySelector('h3').textContent = thumbnail.alt || '地点图片';
      const { tripName, planName, date } = getContext(button) || {};
      dialog.querySelector('#reviewPhotoContext').textContent = [
        [tripName, planName].filter(Boolean).join(' · '), date || '未设置日期'
      ].filter(Boolean).join('\n');
      status.hidden = false;
      status.textContent = '正在加载图片…';
      image.src = thumbnail.getAttribute('src');
      dialog.showModal();
      dialog.querySelector('[data-photo-close]').focus();
    },
    destroy() { dialog.remove(); },
  };
}
