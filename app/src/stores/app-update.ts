import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { checkForUpdate, servedUpdate, type AvailableUpdate } from '@/lib/app-update';
import { isDesktop } from '@/lib/platform';
import { useNodeStore } from './nodes';

const FIRST_CHECK_MS = 10_000;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export type AppUpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'available' }
  /** `progress` is 0-1, or null while the download's size is unknown. */
  | { state: 'installing'; progress: number | null }
  | { state: 'error'; message: string };

interface AppUpdateState {
  status: AppUpdateStatus;
  /** The newest desktop version found, kept through a later failed check. */
  update: AvailableUpdate | null;
  lastChecked: Date | null;
  /** A version the user said Later to; its indicator stays hidden until a newer one or a relaunch. */
  dismissed: string | null;
  dialogOpen: boolean;
  /** Persisted: check at launch and every few hours. Nothing installs until the user says so. */
  autoCheck: boolean;
  /** A background check stays quiet when it fails; a manual one opens the dialog with the answer. */
  check: (options?: { manual?: boolean }) => Promise<void>;
  install: () => Promise<void>;
  later: (version: string) => void;
  openDialog: () => void;
  closeDialog: () => void;
  setAutoCheck: (on: boolean) => void;
}

export const useAppUpdate = create<AppUpdateState>()(
  persist(
    (set, get) => ({
      status: { state: 'idle' },
      update: null,
      lastChecked: null,
      dismissed: null,
      dialogOpen: false,
      autoCheck: true,

      check: async ({ manual = false } = {}) => {
        const { status } = get();
        if (status.state === 'checking' || status.state === 'installing') return;
        if (manual) set({ dialogOpen: true });
        set({ status: { state: 'checking' } });
        try {
          const update = await checkForUpdate();
          set({
            update,
            lastChecked: new Date(),
            status: update ? { state: 'available' } : { state: 'up-to-date' },
          });
        } catch (err) {
          console.warn('App update check failed:', err);
          set({
            lastChecked: new Date(),
            status:
              manual || !get().update
                ? { state: 'error', message: String(err) }
                : { state: 'available' },
          });
        }
      },

      install: async () => {
        const { update, status } = get();
        if (!update || status.state === 'installing') return;
        set({ status: { state: 'installing', progress: null } });
        try {
          await update.install((progress) => set({ status: { state: 'installing', progress } }));
        } catch (err) {
          set({ status: { state: 'error', message: String(err) } });
        }
      },

      later: (version) => set({ dismissed: version, dialogOpen: false }),
      openDialog: () => set({ dialogOpen: true }),
      closeDialog: () => set({ dialogOpen: false }),
      setAutoCheck: (autoCheck) => set({ autoCheck }),
    }),
    {
      name: 'helion-app-update',
      version: 1,
      partialize: (s) => ({ autoCheck: s.autoCheck }),
    },
  ),
);

/**
 * The version this copy of Helion could move to, unless the user said Later
 * to it: a downloaded release on the desktop, or in a browser, a newer agent
 * serving this page.
 */
export function useWaitingVersion(): string | null {
  const desktop = useAppUpdate((s) => s.update?.version ?? null);
  const dismissed = useAppUpdate((s) => s.dismissed);
  const served = useNodeStore((s) =>
    isDesktop() ? null : servedUpdate(s.nodes, s.meta, window.location.origin, __APP_VERSION__),
  );
  const version = desktop ?? served;
  return version && version !== dismissed ? version : null;
}

/**
 * On the desktop, check shortly after launch and then every few hours while
 * `autoCheck` is on. Returns the stop function.
 */
export function startBackgroundChecks(): () => void {
  if (!isDesktop()) return () => {};
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delay: number) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!useAppUpdate.getState().autoCheck) return;
    timer = setTimeout(() => {
      void useAppUpdate.getState().check();
      schedule(CHECK_EVERY_MS);
    }, delay);
  };

  schedule(FIRST_CHECK_MS);
  const unsubscribe = useAppUpdate.subscribe((s, prev) => {
    if (s.autoCheck !== prev.autoCheck) schedule(FIRST_CHECK_MS);
  });
  return () => {
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
