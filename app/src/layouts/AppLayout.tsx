import { AppSidebar } from '@/components/app-sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import TitleBar from '@/components/title-bar';
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/resizable-sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTauriWindow } from '@/hooks/use-tauri-window';

/**
 * The app shell.
 *
 * Deliberately has no data plumbing. Connections are owned by the node store
 * and start when a node is added or rehydrated, so container and volume data
 * stay in sync regardless of which page is mounted. This previously hosted
 * two polling hooks plus one invisible collector component per node, which
 * meant the streams' lifetime was tied to the layout rendering.
 */
export function AppLayout({ children }: { children: React.ReactNode }) {
  useTauriWindow();

  return (
    <ThemeProvider defaultTheme='dark' storageKey='cosmos-theme'>
      <div className='flex flex-col h-screen'>
        <SidebarProvider className='flex-col'>
          <TitleBar />
          <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
            <AppSidebar />
            <SidebarInset className='bg-sidebar min-w-0'>
              <div className='size-full max-w-full bg-background md:rounded-tl-2xl overflow-hidden border-t border-l'>
                <ScrollArea className='h-full w-full rounded-tl-2xl'>
                  <div className='table-cell relative'>
                    <div className='p-4 space-y-4 max-w-full h-full flex flex-col absolute inset-0 @container'>
                      {children}
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </div>
    </ThemeProvider>
  );
}
