import { create } from 'zustand';
import { VolumeInfo } from '@/generated/VolumeInfo';

interface VolumesStore {
  nodeVolumes: Record<string, VolumeInfo[]>;
  setNodeVolumes: (nodeId: string, volumes: VolumeInfo[]) => void;
  removeNode: (nodeId: string) => void;
}

export const useVolumesStore = create<VolumesStore>((set) => ({
  nodeVolumes: {},
  setNodeVolumes: (nodeId, volumes) =>
    set((s) => ({ nodeVolumes: { ...s.nodeVolumes, [nodeId]: volumes } })),
  removeNode: (nodeId) =>
    set((s) => {
      const { [nodeId]: _, ...rest } = s.nodeVolumes;
      return { nodeVolumes: rest };
    }),
}));