import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * What this device notifies about. The agents' own channels (ntfy, webhooks)
 * are separate and set per node.
 */
export type DeviceLevel = 'problems' | 'errors' | 'off';

interface NotificationPrefs {
  level: DeviceLevel;
  /** Minutes a node can be unreachable before saying so. 0 turns it off. */
  unreachableAfterMin: number;
  /** Newest event id seen on the Events page, per node, for the bell. */
  seen: Record<string, number>;
  setLevel: (level: DeviceLevel) => void;
  setUnreachableAfter: (minutes: number) => void;
  markSeen: (nodeId: string, id: number) => void;
}

export const useNotificationPrefs = create<NotificationPrefs>()(
  persist(
    (set) => ({
      level: 'problems',
      unreachableAfterMin: 3,
      seen: {},
      setLevel: (level) => set({ level }),
      setUnreachableAfter: (unreachableAfterMin) => set({ unreachableAfterMin }),
      markSeen: (nodeId, id) =>
        set((s) => ((s.seen[nodeId] ?? 0) >= id ? s : { seen: { ...s.seen, [nodeId]: id } })),
    }),
    { name: 'cosmos-notifications', version: 1 },
  ),
);
