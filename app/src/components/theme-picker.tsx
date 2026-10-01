import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';
import { Scheme, ThemeDef, themesOf } from '@/lib/themes';
import { cn } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

const SCHEMES: { scheme: Scheme; label: string; icon: typeof Moon }[] = [
  { scheme: 'dark', label: 'Dark', icon: Moon },
  { scheme: 'light', label: 'Light', icon: Sun },
];

/**
 * A theme's background with its primary inside. Scoped with `data-theme`,
 * so it shows the theme's real tokens whatever theme the page is in.
 */
export function ThemeSwatch({ id, className }: { id: string; className?: string }) {
  return (
    <span
      data-theme={id}
      aria-hidden='true'
      className={cn('grid size-4 shrink-0 place-items-center rounded-full border bg-background', className)}
    >
      <span className='size-1.5 rounded-full bg-primary' />
    </span>
  );
}

/** A thumbnail of the shell in a theme: frame, sidebar, a card, metrics. */
function ThemePreview({ id }: { id: string }) {
  return (
    <div
      data-theme={id}
      aria-hidden='true'
      className='flex aspect-16/9 w-full overflow-hidden rounded-md border bg-sidebar'
    >
      <div className='flex w-1/5 flex-col gap-1 px-1 pt-3'>
        <span className='h-1.5 rounded-xs bg-sidebar-accent' />
        <span className='mx-0.5 h-1 rounded-full bg-sidebar-foreground/40' />
        <span className='mx-0.5 h-1 rounded-full bg-sidebar-foreground/40' />
        <span className='mx-0.5 h-1 rounded-full bg-sidebar-foreground/40' />
      </div>
      <div className='mt-2 flex flex-1 flex-col gap-1.5 rounded-tl-md border-t border-l bg-background p-1.5'>
        <div className='flex items-center justify-between'>
          <span className='h-1.5 w-1/3 rounded-full bg-foreground/80' />
          <span className='h-2 w-1/5 rounded-xs bg-primary' />
        </div>
        <div className='grid flex-1 grid-cols-2 gap-1'>
          {(['cpu', 'ram'] as const).map((m, i) => (
            <div key={m} className='flex flex-col justify-between rounded-xs border bg-card p-1'>
              <span className='h-1 w-2/3 rounded-full bg-muted-foreground/60' />
              <svg viewBox='0 0 40 12' className='h-3 w-full' preserveAspectRatio='none'>
                <polyline
                  points={i ? '0,9 8,8 16,9 24,5 32,6 40,4' : '0,10 8,6 16,7 24,3 32,5 40,2'}
                  fill='none'
                  stroke={`var(--${m})`}
                  strokeWidth='1.5'
                  vectorEffect='non-scaling-stroke'
                />
              </svg>
            </div>
          ))}
        </div>
        <div className='flex gap-1'>
          {(['cpu', 'ram', 'network', 'disk'] as const).map((m) => (
            <span key={m} className='h-1 flex-1 rounded-full' style={{ background: `var(--${m})` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeCard({ theme, badge }: { theme: ThemeDef; badge?: Scheme }) {
  const inputId = `theme-${theme.id}`;
  return (
    <Label
      htmlFor={inputId}
      className={cn(
        'flex cursor-pointer flex-col items-stretch gap-2 rounded-lg border p-2 font-normal transition-colors',
        'hover:bg-accent/50 has-data-checked:border-primary has-data-checked:bg-accent/40',
        'has-focus-visible:ring-3 has-focus-visible:ring-ring/50',
      )}
    >
      <ThemePreview id={theme.id} />
      <span className='flex items-center gap-2'>
        <RadioGroupItem id={inputId} value={theme.id} className='focus-visible:ring-0' />
        <span className='min-w-0 flex-1 truncate text-sm font-medium'>{theme.name}</span>
        {badge && (
          <span className='text-muted-foreground' title={`Used when the system is ${badge}`}>
            {badge === 'dark' ? <Moon className='size-3.5' /> : <Sun className='size-3.5' />}
          </span>
        )}
      </span>
      <span className='truncate text-xs text-muted-foreground'>{theme.description}</span>
    </Label>
  );
}

/**
 * Settings > Appearance: every theme as a card, grouped by scheme, one radio
 * group so arrow keys move through them all. Below, Follow system and the
 * theme it uses for each OS scheme.
 */
export function ThemeSettings() {
  const { themeId, setThemeId, followSystem, setFollowSystem, pair, setPair } = useTheme();

  return (
    <div className='flex flex-col gap-4 p-4'>
      <RadioGroup
        aria-label='Theme'
        value={followSystem ? '' : themeId}
        onValueChange={setThemeId}
        className='flex flex-col gap-4'
      >
        {SCHEMES.map(({ scheme, label }) => (
          <div key={scheme} role='group' aria-label={label} className='flex flex-col gap-2'>
            <h3 className='label-hud text-2xs text-muted-foreground'>{label}</h3>
            <div className='grid grid-cols-2 gap-2 @xl:grid-cols-3 @4xl:grid-cols-4'>
              {themesOf(scheme).map((t) => (
                <ThemeCard key={t.id} theme={t} badge={followSystem && pair[scheme] === t.id ? scheme : undefined} />
              ))}
            </div>
          </div>
        ))}
      </RadioGroup>

      <div className='flex flex-col gap-3 border-t pt-4'>
        <div className='flex items-center justify-between gap-4'>
          <div className='grid gap-1'>
            <Label htmlFor='follow-system'>Follow system</Label>
            <span className='text-xs text-muted-foreground'>
              Switch between a light and a dark theme with your device
            </span>
          </div>
          <Switch id='follow-system' checked={followSystem} onCheckedChange={setFollowSystem} />
        </div>
        {followSystem && (
          <div className='flex flex-wrap gap-x-8 gap-y-3'>
            {[...SCHEMES].reverse().map(({ scheme, label, icon: Icon }) => (
              <div key={scheme} className='flex items-center gap-3'>
                <Label htmlFor={`pair-${scheme}`} className='w-14 font-normal text-muted-foreground'>
                  <Icon className='size-4' /> {label}
                </Label>
                <Select value={pair[scheme]} onValueChange={(id) => setPair(scheme, id)}>
                  <SelectTrigger id={`pair-${scheme}`} className='w-44'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {themesOf(scheme).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        <ThemeSwatch id={t.id} /> {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
