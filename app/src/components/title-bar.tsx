import { memo } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { ChevronRight, Copy, Minus, PanelLeft, Search, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSidebar } from '@/components/ui/resizable-sidebar';
import { useNodeName, useNodeStore } from '@/stores/nodes';
import { useUiStore } from '@/stores/ui';
import { pageFor } from '@/lib/navigation';
import { getPlatform } from '@/lib/platform';
import { cn } from '@/lib/utils';
import { useWindowState, windowAction } from '@/hooks/use-window-state';
import { Hint, ShortcutKeys } from './hint';
import { ThemeToggle } from './theme-toggle';
import { Dot } from './dot';

function Breadcrumb() {
  const { pathname } = useLocation();
  const page = pageFor(pathname);
  const nodeId = pathname.startsWith('/nodes/') ? pathname.split('/')[2] : null;
  const nodeName = useNodeName(nodeId);

  if (!page) return null;
  return (
    <nav aria-label='Breadcrumb' className='flex min-w-0 items-center gap-1 text-sm'>
      {nodeName ? (
        <>
          <Link
            to={page.path}
            className='text-muted-foreground transition-colors hover:text-foreground'
          >
            {page.label}
          </Link>
          <ChevronRight className='size-3.5 shrink-0 text-muted-foreground' />
          <span className='truncate font-medium'>{nodeName}</span>
        </>
      ) : (
        <span className='truncate font-medium'>{page.label}</span>
      )}
    </nav>
  );
}

function SearchTrigger() {
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  return (
    <button
      type='button'
      onClick={() => setPaletteOpen(true)}
      className='flex h-8 w-full items-center gap-2 rounded-md border border-input bg-muted/40 px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
    >
      <Search className='size-4 shrink-0' />
      <span className='flex-1 truncate text-left'>Search or jump to</span>
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
        className='hidden h-8 items-center gap-2 rounded-md px-2 text-xs text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground md:flex'
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
          <Button variant='ghost' size='icon' onClick={toggleSidebar} aria-label='Toggle sidebar'>
            <PanelLeft />
          </Button>
        </Hint>
        <Breadcrumb />
      </div>

      <SearchTrigger />

      <div className={cn('flex items-center justify-end gap-1', !customControls && 'pr-2')}>
        <NodesOnline />
        <ThemeToggle />
        {customControls && <WindowControls maximized={maximized} />}
      </div>
    </header>
  );
});

export default TitleBar;
