import { toast } from 'sonner';
import { isDesktop } from './platform';

export type AlertTone = 'error' | 'warning' | 'success' | 'info';

/**
 * Tells the person at this device: a toast while they're looking at the app,
 * a system notification from the desktop app when they aren't. A browser tab
 * that isn't focused just gets the toast for when they come back.
 */
export async function deviceAlert(title: string, body: string | null, tone: AlertTone): Promise<void> {
  if (isDesktop() && !document.hasFocus() && (await systemNotify(title, body))) return;
  const show = { error: toast.error, warning: toast.warning, success: toast.success, info: toast.info }[tone];
  show(title, { description: body ?? undefined });
}

/** False when the OS said no, so the caller can fall back to a toast. */
async function systemNotify(title: string, body: string | null): Promise<boolean> {
  try {
    const n = await import('@tauri-apps/plugin-notification');
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === 'granted';
    if (granted) n.sendNotification({ title, body: body ?? undefined });
    return granted;
  } catch {
    return false;
  }
}
