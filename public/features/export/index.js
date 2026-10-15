export function pngFilePart(value) {
  return String(value || 'roadtrip').trim().replace(/[\\/:*?"<>|\s]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'roadtrip';
}

export async function downloadBlob(blob, filename, _title = filename) {
  // “下载”必须直接保存文件；不再因为设备支持 Web Share 就强制打开分享面板。
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

export async function downloadCanvasPng(canvas, filename) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 文件生成失败。');
  return downloadBlob(blob, filename, '导出行程图片');
}
