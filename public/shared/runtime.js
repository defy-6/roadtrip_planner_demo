export const runtime = Object.freeze({
  shareMode: Boolean(window.__ROADTRIP_SHARE_MODE__),
  shareData: window.__ROADTRIP_SHARE_DATA__ || null,
  assetBase: window.__ROADTRIP_SHARE_MODE__ ? './' : '/',
  editable: !window.__ROADTRIP_SHARE_MODE__
});
