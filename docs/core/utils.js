export const $ = (selector, element = document) => element.querySelector(selector);
export const clockToMinute = time => { const [hour, minute] = (time || '00:00').split(':').map(Number); return hour * 60 + minute; };
export const minuteToClock = minute => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
export function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; }
export const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
