export type Platform = 'macos' | 'windows' | 'linux' | 'web';

declare global {
  interface Window {
    __COSMOS_PLATFORM__?: Exclude<Platform, 'web'>;
  }
}

/** Set by the Tauri init script; `web` in a browser. */
export function getPlatform(): Platform {
  const fromHtml = document.documentElement.dataset.platform as Platform | undefined;
  return fromHtml ?? window.__COSMOS_PLATFORM__ ?? 'web';
}

/** Copies the injected platform onto <html> for CSS. Call before render. */
export function applyPlatform(): Platform {
  const platform = window.__COSMOS_PLATFORM__ ?? 'web';
  document.documentElement.dataset.platform = platform;
  return platform;
}

export const isDesktop = (p: Platform = getPlatform()) => p !== 'web';

/** Mac keyboard conventions, in the app or in a browser on a Mac. */
export function usesMacKeys(p: Platform = getPlatform()): boolean {
  if (p === 'macos') return true;
  if (p !== 'web') return false;
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);
}
