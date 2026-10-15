// Display-only place context; runtime owns travel and plan selection.
export function createPlaceEditorContext({ dialog, getContext }) {
  const context = dialog.ownerDocument.createElement('p');
  context.id = 'placeEditorContext';
  context.className = 'place-editor-context';
  dialog.querySelector('h3').after(context);
  const descriptions = new Set((dialog.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  descriptions.add(context.id);
  dialog.setAttribute('aria-describedby', [...descriptions].join(' '));
  return {
    render() {
      const { tripName, planName } = getContext();
      context.textContent = [tripName ? `所属行程：${tripName}` : '', planName ? `当前方案：${planName}` : ''].filter(Boolean).join('\n');
      context.hidden = !context.textContent;
    }
  };
}
