export function pngFilePart(value) {
  return String(value || 'roadtrip').trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'roadtrip';
}

export function downloadCanvasPng(canvas, filename) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
