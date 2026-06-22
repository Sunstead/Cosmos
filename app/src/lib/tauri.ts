export const isTauri = () => '__TAURI_INTERNALS__' in window;

export const getWindow = () =>
  isTauri()
    ? import('@tauri-apps/api/window').then((m) => m.getCurrentWindow())
    : null;
