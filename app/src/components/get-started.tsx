import { Link } from '@tanstack/react-router';
import { Check, ChevronRight } from 'lucide-react';
import { useNodeStore } from '@/stores/nodes';
import { useContainersStore } from '@/stores/containers';
import { userFacingServices } from '@/lib/services';
import { PagePath } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { Section } from './section';
import { SetupHint, SETUP, SetupInfo } from './setup-hint';

interface Step {
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

/** Onboarding checklist. Hidden by the caller once every step is done. */
export function GetStarted({ steps }: { steps: Step[] }) {
  const done = steps.filter((s) => s.done).length;

  return (
    <Section title='Get started' count={`${done}/${steps.length}`} contentClassName='divide-y'>
      {steps.map((s) => (
        <div key={s.label} className='flex items-center gap-3 px-4 py-2.5'>
          <span
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded-full border',
              s.done && 'border-success bg-success/15 text-success',
            )}
          >
            {s.done && <Check className='size-3' />}
          </span>
          <Link
            to={s.to}
            className={cn(
              'flex-1 text-sm hover:underline',
              s.done && 'text-muted-foreground line-through decoration-muted-foreground/40',
            )}
          >
            {s.label}
          </Link>
          {!s.done && s.setup && <SetupHint info={s.setup} />}
          {!s.done && <ChevronRight className='size-4 text-muted-foreground' />}
        </div>
      ))}
    </Section>
  );
}
