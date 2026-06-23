import { AppSidebar } from '@/components/app-sidebar';
import { ThemeProvider } from '@/components/theme-provider';
import TitleBar from '@/components/title-bar';
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/resizable-sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTauriWindow } from '@/hooks/use-tauri-window';

export function AppLayout({ children }: { children: React.ReactNode }) {
  useTauriWindow();
  const isDesktop = true;

  return (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <div className='flex flex-col h-screen'>
        <SidebarProvider className='flex-col'>
          <TitleBar />
          <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
            <AppSidebar />
            <SidebarInset className='bg-sidebar min-w-0'>
              <div
                className={`size-full max-w-full bg-background ${isDesktop ? 'md:rounded-tl-2xl overflow-hidden border-t' : ''} border-l`}
              >
                <ScrollArea className='h-full w-full rounded-tl-2xl'>
                  {children}
                </ScrollArea>
              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </div>
    </ThemeProvider>
  );
}
