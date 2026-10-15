// 版本冲突（VERSION_CONFLICT）统一处置。
// 原则：绝不用本地未核对的数据静默覆盖云端（也不用云端静默覆盖本地未保存改动）。
// 冲突时交给用户显式选择：重新加载（丢弃本次本地改动）或取消（保留本地、稍后自行处理）。
// 服务端已保证"后写者 409"，这里只负责把冲突以可理解、可恢复的方式呈现，不做自动合并。

function isVersionConflict(error) {
  if (!error) return false;
  if (error.code === 'VERSION_CONFLICT') return true;
  // 兼容极旧后端：仅有 409 + 冲突语义文案时也按冲突处理。
  return Number(error.status) === 409 && /冲突|已被其他协作者|已被更新/.test(String(error.message || ''));
}

// 返回 Promise<boolean>：
//   true  = 用户选择"重新加载"，已调用 onReload（本地改动被丢弃，云端为权威）
//   false = 用户选择"保留本地"（不改动云端，调用方必须保留本地草稿、不得清空）
function resolveVersionConflict({ error, onReload, title = '数据已被他人更新' } = {}) {
  return new Promise(resolve => {
    const message = (error && error.message) || '云端行程已被其他协作者更新。';
    wx.showModal({
      title,
      content: `${message}\n\n为避免覆盖他人修改，请选择：\n· 重新加载：丢弃本次本地改动，拉取云端最新数据\n· 保留本地：本次改动留在本机，稍后自行重试`,
      confirmText: '重新加载',
      cancelText: '保留本地',
      success: res => {
        if (res.confirm) {
          if (typeof onReload !== 'function') { resolve(false); return; }
          Promise.resolve()
            .then(onReload)
            .then(result => resolve(result === true))
            .catch(() => resolve(false));
        } else {
          resolve(false);
        }
      },
      fail: () => resolve(false),
    });
  });
}

module.exports = { isVersionConflict, resolveVersionConflict };
