// Search-panel geometry only; candidate selection and persistence stay with the editor.
export function createSearchPosition({ input, panel }) {
  const documentRef = input.ownerDocument;
  const windowRef = documentRef.defaultView;
  const fit = () => {
    const viewport = windowRef.visualViewport;
    const viewportTop = viewport?.offsetTop || 0;
    const viewportBottom = viewportTop + (viewport?.height || windowRef.innerHeight);
    const rect = input.getBoundingClientRect();
    const dialog = input.closest('dialog');
    const dialogTop = dialog?.getBoundingClientRect().top || 0;
    const headingBottom = dialog?.querySelector('h3')?.getBoundingClientRect().bottom ?? dialogTop;
    const safeTop = Math.max(viewportTop + 8, dialogTop + 8, headingBottom + 8);
    const actionTop = dialog?.querySelector('.editor-actions')?.getBoundingClientRect().top ?? viewportBottom;
    const availableBottom = Math.max(0, Math.min(viewportBottom - 12, actionTop - 8) - rect.bottom - 4);
    const aboveBottom = Math.min(rect.top - 4, actionTop - 8, viewportBottom - 12);
    const availableTop = Math.max(0, aboveBottom - safeTop);
    const mobile = documentRef.documentElement.dataset.previewMode === 'mobile';
    const openAbove = mobile && availableBottom < 120 && availableTop > availableBottom;
    const available = openAbove ? availableTop : availableBottom;
    const maxHeight = Math.max(56, Math.min(320, available));
    panel.style.maxHeight = `${maxHeight}px`;
    if (mobile) {
      const targetTop = openAbove ? Math.max(safeTop - 4, aboveBottom - maxHeight - 4) : Math.max(viewportTop + 8, rect.bottom);
      panel.dataset.placement = openAbove ? 'above' : 'below';
      // A top-layer dialog is the fixed panel's containing block.
      panel.style.top = `${targetTop - dialogTop}px`;
    }
  };
  const sync = () => { if (!panel.hidden) fit(); };
  input.closest('.editor-form')?.addEventListener('scroll', sync, { passive: true });
  windowRef.visualViewport?.addEventListener('resize', sync);
  windowRef.visualViewport?.addEventListener('scroll', sync);
  return { fit };
}
