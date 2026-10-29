/**
 * Updates to Helion itself, not to the services it watches (that's the
 * Updates page). The desktop app uses Tauri's updater against the
 * `latest.json` each published GitHub release carries (`plugins.updater` in
 * tauri.conf.json). The web UI comes from an agent, so it's updated by
 * deploying that agent; a tab left open across the deploy is offered a reload.
 */
import { isDesktop } from './platform';
import { isNewer } from './version';
import type { NodeConfig } from '@/stores/nodes';
import type { NodeMeta } from '@/api/connection';

export interface AvailableUpdate {
  version: string;
  /** The release's notes, as written on GitHub. */
  notes: string;
  /** Download, install and restart into it. `progress` is 0-1, or null while the size is unknown. */
  install(onProgress: (progress: number | null) => void): Promise<void>;
}

/**
 * A newer desktop app than this one, if the latest release has one. Null
 * outside the desktop app. Throws when the check fails.
 */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isDesktop()) return null;
  // Imported here so the web bundle never loads the plugins.
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    notes: update.body ?? '',
    async install(onProgress) {
      let total: number | undefined;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength;
          onProgress(total ? 0 : null);
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength;
          onProgress(total ? Math.min(received / total, 1) : null);
        }
      });
      // Windows has quit by now, for the installer; macOS and Linux restart here.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    },
  };
}

/**
 * The version the agent serving this page runs, when it's newer than the
 * page: it was deployed while the tab was open. Null in the desktop app, on
 * the dev server (no node shares its origin) and after a rollback.
 */
export function servedUpdate(
  nodes: NodeConfig[],
  meta: Record<string, NodeMeta>,
  origin: string,
  current: string,
): string | null {
  for (const node of nodes) {
    let nodeOrigin: string;
    try {
      nodeOrigin = new URL(node.url).origin;
    } catch {
      continue;
    }
    if (nodeOrigin !== origin) continue;
    const version = meta[node.id]?.agentVersion;
    if (version && isNewer(version, current)) return version;
  }
  return null;
}
