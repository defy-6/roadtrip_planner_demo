// Solid-background text audit only; gradients, images and translucent ancestors
// require visual review rather than a fabricated contrast result.
export async function auditVisibleTextContrast(page, rootSelector = 'body') {
  return page.evaluate(rootSelector => {
    const parse = color => {
      const channels = color.match(/[\d.]+/g)?.map(Number);
      return channels?.length >= 3 ? [...channels.slice(0, 3), channels[3] ?? 1] : null;
    };
    const blend = (front, back) => front.slice(0, 3).map((value, index) => value * front[3] + back[index] * (1 - front[3]));
    const luminance = rgb => rgb.map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const issues = [];
    let checked = 0;
    let unsupported = 0;
    const root = document.querySelector(rootSelector);
    if (!root) throw new Error(`Contrast audit root not found: ${rootSelector}`);
    for (const element of [root, ...root.querySelectorAll('*')]) {
      let text = [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim();
      let placeholderStyle = null;
      // Never inspect password values. Inputs otherwise have no text child nodes.
      if (element.matches('input[type="password"]')) continue;
      if (element.matches('input,textarea')) {
        text = element.value || element.placeholder || '';
        if (!element.value && element.placeholder) placeholderStyle = getComputedStyle(element, '::placeholder');
      }
      if (element.matches('select')) text = element.selectedOptions[0]?.textContent || '';
      if (!text || element.closest('[aria-hidden="true"],:disabled,script,style,svg') || !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) continue;
      const styles = [];
      for (let parent = element; parent; parent = parent.parentElement) styles.push(getComputedStyle(parent));
      if (styles.some(style => style.backgroundImage !== 'none' || Number(style.opacity) !== 1)) { unsupported += 1; continue; }
      const style = styles[0];
      const textStyle = placeholderStyle || style;
      const foreground = parse(textStyle.color);
      if (!foreground) { unsupported += 1; continue; }
      if (placeholderStyle) foreground[3] *= Number(placeholderStyle.opacity);
      if (foreground[3] === 0 || parseFloat(style.fontSize) === 0) continue;
      let background = [255, 255, 255];
      for (const ancestor of styles.reverse()) {
        const color = parse(ancestor.backgroundColor);
        if (color) background = blend(color, background);
      }
      const foregroundLuminance = luminance(blend(foreground, background));
      const backgroundLuminance = luminance(background);
      const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + .05) / (Math.min(foregroundLuminance, backgroundLuminance) + .05);
      const size = parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.667 && Number(style.fontWeight) >= 700);
      const threshold = large ? 3 : 4.5;
      checked += 1;
      if (ratio < threshold) issues.push({ element: element.id || element.className || element.tagName, text: placeholderStyle ? 'placeholder' : text.slice(0, 45), color: textStyle.color, background, ratio: Number(ratio.toFixed(2)), threshold });
    }
    return { checked, unsupported, issues };
  }, rootSelector);
}
