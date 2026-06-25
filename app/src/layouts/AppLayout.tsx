import { AppSidebar } from '@/components/app-sidebar';
import { NodeMetricsCollector } from '@/components/node-metrics-collector';
import { ThemeProvider } from '@/components/theme-provider';
import TitleBar from '@/components/title-bar';
import {
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/resizable-sidebar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTauriWindow } from '@/hooks/use-tauri-window';
import { useNodeStore } from '@/stores/nodes';

export function AppLayout({ children }: { children: React.ReactNode }) {
  useTauriWindow();
  const nodes = useNodeStore((s) => s.nodes);

  return (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      {nodes.map((n) => (
        <NodeMetricsCollector key={n.id} nodeId={n.id} />
      ))}
      <div className='flex flex-col h-screen'>
        <SidebarProvider className='flex-col'>
          <TitleBar />
          <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
            <AppSidebar />
            <SidebarInset className='bg-sidebar min-w-0'>
              <div
                className={`size-full max-w-full bg-background md:rounded-tl-2xl overflow-hidden border-t border-l`}
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
