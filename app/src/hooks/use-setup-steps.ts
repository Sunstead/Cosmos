import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { userFacingServices } from '@/lib/services';
import { PagePath } from '@/lib/navigation';
import { SETUP, SetupInfo } from '@/lib/setup';

export interface Step {
  label: string;
  done: boolean;
  to: PagePath;
  setup?: SetupInfo;
}

export function useSetupSteps(): Step[] {
  const nodes = useNodeStore((s) => s.nodes.length);
  const metas = useNodeStore((s) => s.meta);
  const hasServices = useContainersStore((s) => userFacingServices(s.services).length > 0);
  const any = (key: 'metrics_history' | 'backups') =>
    Object.values(metas).some((m) => m.status === 'online' && m.capabilities[key]);

  return [
    { label: 'Add a node', done: nodes > 0, to: '/nodes' },
    { label: 'Label a service', done: hasServices, to: '/services', setup: SETUP.services },
    { label: 'Enable history', done: any('metrics_history'), to: '/monitoring', setup: SETUP.history },
    { label: 'Configure backups', done: any('backups'), to: '/backups', setup: SETUP.backups },
  ];
}
