import { Link } from '@tanstack/react-router';
import { Check, ChevronRight } from 'lucide-react';
import { Step } from '@/hooks/use-setup-steps';
import { cn } from '@/lib/utils';
import { Section } from './section';
import { SetupHint } from './setup-hint';

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
