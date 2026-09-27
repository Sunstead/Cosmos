import { memo } from 'react';
import { Link } from '@tanstack/react-router';
import { Copy, Minus, PanelLeft, Search, Square, X } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/resizable-sidebar';
import { useNodeStore } from '@/stores/nodes';
import { useUiStore } from '@/stores/ui';
import { getPlatform } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useWindowState, windowAction } from '@/hooks/use-window-state';
import { Hint, ShortcutKeys } from './hint';
import { ThemeToggle } from './theme-toggle';
import { Dot } from './dot';
import { EventsBell } from './events-bell';

function SearchTrigger() {
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  return (
    <button
      type='button'
      onClick={() => setPaletteOpen(true)}
      aria-label='Search'
      className='flex h-8 w-full items-center gap-2 rounded-lg border border-input bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:hover:bg-input/50'
    >
      <Search className='size-4 shrink-0' />
      <span className='flex-1 truncate text-left'>Search</span>
      <ShortcutKeys id='palette' className='hidden sm:inline-flex' />
    </button>
  );
}

function NodesOnline() {
  const total = useNodeStore((s) => s.nodes.length);
  const online = useNodeStore((s) => s.onlineNodes);
  if (total === 0) return null;

  const healthy = online === total;
  return (
    <Hint label={healthy ? 'All nodes online' : `${total - online} offline`}>
      <Link
        to='/nodes'
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          'hidden text-xs tabular-nums text-muted-foreground md:inline-flex',
        )}
      >
        <Dot variant={healthy ? 'success' : 'error'} pulse={healthy} />
        {online}/{total}
      </Link>
    </Hint>
  );
}

function WindowControls({ maximized }: { maximized: boolean }) {
  const base =
    'flex h-12 w-11 items-center justify-center text-muted-foreground transition-colors';
  return (
    <div className='flex self-stretch'>
      <button
        type='button'
        aria-label='Minimize'
        className={cn(base, 'hover:bg-muted hover:text-foreground')}
        onClick={() => void windowAction('minimize')}
      >
        <Minus className='size-4' />
      </button>
      <button
        type='button'
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={cn(base, 'hover:bg-muted hover:text-foreground')}
        onClick={() => void windowAction('toggleMaximize')}
      >
        {maximized ? <Copy className='size-3.5 -scale-x-100' /> : <Square className='size-3.5' />}
      </button>
      <button
        type='button'
        aria-label='Close'
        className={cn(base, 'hover:bg-destructive hover:text-white')}
        onClick={() => void windowAction('close')}
      >
        <X className='size-4' />
      </button>
    </div>
  );
}

export const TitleBar = memo(function TitleBar() {
  const platform = getPlatform();
  const { fullscreen, maximized } = useWindowState();
  const { toggleSidebar } = useSidebar();
  const customControls = platform === 'windows' || platform === 'linux';

  return (
    <header
      // Descendants drag too; buttons and links are excluded automatically.
      data-tauri-drag-region='deep'
      data-fullscreen={fullscreen || undefined}
      className='titlebar chrome grid h-(--titlebar-height) shrink-0 grid-cols-[1fr_minmax(0,28rem)_1fr] items-center gap-3 bg-sidebar'
    >
      <div className='flex min-w-0 items-center gap-2 pl-2'>
        <span className='titlebar-inset shrink-0' aria-hidden='true' />
        <Hint label='Toggle sidebar' shortcut='sidebar'>
          <Button
            variant='ghost'
            size='icon'
            className='text-muted-foreground'
            onClick={toggleSidebar}
            aria-label='Toggle sidebar'
          >
            <PanelLeft />
          </Button>
        </Hint>
      </div>

      <SearchTrigger />

      <div className={cn('flex items-center justify-end gap-1', !customControls && 'pr-2')}>
        <NodesOnline />
        <EventsBell />
        <ThemeToggle />
        {customControls && <WindowControls maximized={maximized} />}
      </div>
    </header>
  );
});

export default TitleBar;
