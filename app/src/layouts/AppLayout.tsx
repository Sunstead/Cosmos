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
                  {/*
                    `min-h-full` rather than `h-full`: with a fixed height the
                    flex column had to distribute space, and flex-shrink
                    collapsed whichever card had the most wrappable content —
                    the node detail spec panel rendered 32px tall with all its
                    text inside it. Growing past the viewport and letting the
                    ScrollArea scroll is what's actually wanted.
                  */}
                  <div className='flex min-h-full max-w-full flex-col gap-4 p-4 @container'>
                    {children}
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
