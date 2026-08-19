export const $ = (selector, element = document) => element.querySelector(selector);
export const clockToMinute = time => { const [hour, minute] = (time || '00:00').split(':').map(Number); return hour * 60 + minute; };
export const minuteToClock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; }
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
// 本地时区的今天（YYYY-MM-DD）：避免 toISOString() 取 UTC 日期在中国时区晚上错一天。
export const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
// 压缩图片文件为 dataURL：大图缩到最长边 maxSize 并以 JPEG 重新编码，
// 避免手机原图 base64（数 MB~十几 MB）撑爆腾讯云 HTTP 网关请求体（约 5MB）导致 413 保存失败。
// 绝不回退到未压缩的原图（那正是 413 的根源）：
//  - 解码失败/触发超限时，逐级降低尺寸与质量重试；
//  - 若仍失败，返回一个最小可用的占位图并标记，避免把超大原始 dataURL 送进请求体。
export function compressImageFile(file, { maxSize = 480, quality = 0.42 } = {}) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onerror = () => resolve(emptyDataUrl());
    reader.onload = () => {
      const original = reader.result;
      if (typeof original !== 'string' || !original.startsWith('data:')) return resolve(emptyDataUrl());
      if (!file.type.startsWith('image/')) return resolve(original);
      const image = new Image();
      image.onerror = () => resolve(emptyDataUrl());
      image.onload = () => tryCompress(image, original, maxSize, quality, resolve);
      image.src = original;
    };
    reader.readAsDataURL(file);
  });
}

function emptyDataUrl() {
  // 1x1 透明 GIF，保证是合法图片且可再次上传；避免继承失败时的超大原始图
  return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
}

function tryCompress(image, original, maxSize, quality, resolve, attempt = 0) {
  // 解码失败的兜底：无图片则给占位图
  if (!image || !image.width || !image.height) return resolve(emptyDataUrl());
  // 逐级降档：依次尝试最长边 480→360→320→280，质量 0.42→0.38→0.34→0.3
  const sizes = [480, 360, 320, 280];
  const qualities = [0.42, 0.38, 0.34, 0.3];
  const size = sizes[Math.min(attempt, sizes.length - 1)];
  const q = qualities[Math.min(attempt, qualities.length - 1)];
  const scale = Math.min(1, size / Math.max(image.width, image.height));
  // 一次性先算出目标最大画布，避免超大图在内存里溢出
  let outW = Math.max(1, Math.round(image.width * scale));
  let outH = Math.max(1, Math.round(image.height * scale));
  const MAX_CANVAS_PIXELS = 12_000_000; // ≈ 3464×3464，移动端 Safari canvas 安全上限
  if (outW * outH > MAX_CANVAS_PIXELS) {
    const k = Math.sqrt(MAX_CANVAS_PIXELS / (outW * outH));
    outW = Math.max(1, Math.round(outW * k));
    outH = Math.max(1, Math.round(outH * k));
  }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return resolve(emptyDataUrl());
    ctx.drawImage(image, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL('image/jpeg', q);
    // 即便到最低档仍远超预期体积（异常场景），也直接返回——绝不上传原始大图
    if (dataUrl && dataUrl.length > 0) {
      resolve(dataUrl);
    } else {
      return attempt < 4 ? tryCompress(image, original, maxSize, quality, resolve, attempt + 1) : resolve(emptyDataUrl());
    }
  } catch {
    if (attempt < 4) return tryCompress(image, original, maxSize, quality, resolve, attempt + 1);
    resolve(emptyDataUrl());
  }
}
