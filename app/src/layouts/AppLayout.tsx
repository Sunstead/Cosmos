import type { CSSProperties } from 'react';
import { useMatches } from '@tanstack/react-router';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBar } from '@/components/title-bar';
import { CommandHost } from '@/components/command-host';
import { WolWatcher } from '@/components/wol-watcher';
import { NotificationWatcher } from '@/components/notification-watcher';
import { AddNodeDialog } from '@/components/add-node';
import { CommandPalette } from '@/components/command-palette';
import { SidebarInset, SidebarProvider } from '@sunstead/ui/components/resizable-sidebar';
import { ScrollArea } from '@sunstead/ui/components/scroll-area';
import { useStatusToasts } from '@/hooks/use-status-toasts';
import { useUnreachableAlerts } from '@/hooks/use-unreachable-alerts';
import { usePersistentState } from '@/hooks/use-persistent-state';

export type PageLayout = 'scroll' | 'fill' | 'bleed';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /**
     * `fill` pages size to the viewport and scroll internally (logs);
     * `bleed` pages take the whole content area, no padding (constellation).
     */
    layout?: PageLayout;
  }
}

const CONTENT = 'flex max-w-full flex-col gap-4 p-4 @container';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const matches = useMatches();
  const layout = matches.at(-1)?.staticData.layout ?? 'scroll';
  useStatusToasts();
  useUnreachableAlerts();
  // localStorage, not a cookie: cookies don't persist under Tauri's custom protocol.
  const [sidebarOpen, setSidebarOpen] = usePersistentState('cosmos-sidebar-open', true);
  const [sidebarWidth, setSidebarWidth] = usePersistentState('cosmos-sidebar-width', '18rem');

  return (
    <SidebarProvider
      open={sidebarOpen}
      onOpenChange={setSidebarOpen}
      defaultWidth={sidebarWidth}
      onWidthChange={(px) => setSidebarWidth(`${px}px`)}
      // Cosmos's collapsed rail is 4rem, wider than the shared default.
      style={{ '--sidebar-width-icon': '4rem' } as CSSProperties}
      className='h-full flex-col'
    >
      <CommandHost />
      <WolWatcher />
      <NotificationWatcher />
      <AddNodeDialog />
      <CommandPalette />
      <TitleBar />
      <div className='relative flex min-h-0 w-full max-w-full flex-1'>
        <AppSidebar />
        <SidebarInset className='min-w-0 bg-sidebar'>
          <main className='size-full max-w-full overflow-hidden border-t border-l bg-background md:rounded-tl-2xl'>
            {layout === 'bleed' ? (
              <div className='flex size-full flex-col @container'>{children}</div>
            ) : layout === 'fill' ? (
              <div className={`${CONTENT} h-full`}>{children}</div>
            ) : (
              <ScrollArea className='h-full w-full'>
                <div className={`${CONTENT} min-h-full`}>{children}</div>
              </ScrollArea>
            )}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
