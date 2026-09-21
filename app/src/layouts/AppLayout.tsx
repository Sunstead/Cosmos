import { useMatches } from '@tanstack/react-router';
import { AppSidebar } from '@/components/app-sidebar';
import { TitleBar } from '@/components/title-bar';
import { CommandHost } from '@/components/command-host';
import { SidebarInset, SidebarProvider } from '@/components/ui/resizable-sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStatusToasts } from '@/hooks/use-status-toasts';

export type PageLayout = 'scroll' | 'fill';

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    /** `fill` pages size to the viewport and scroll internally (logs). */
    layout?: PageLayout;
  }
}

const CONTENT = 'flex max-w-full flex-col gap-4 p-4 @container';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const matches = useMatches();
  const layout = matches.at(-1)?.staticData.layout ?? 'scroll';
  useStatusToasts();

  return (
    <SidebarProvider className='h-full flex-col'>
      <CommandHost />
      <TitleBar />
      <div className='relative flex min-h-0 w-full max-w-full flex-1'>
        <AppSidebar />
        <SidebarInset className='min-w-0 bg-sidebar'>
          <main className='size-full max-w-full overflow-hidden border-t border-l bg-background md:rounded-tl-2xl'>
            {layout === 'fill' ? (
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
