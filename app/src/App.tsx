import './App.css';
import { AppSidebar } from './components/app-sidebar';
import { ThemeProvider } from './components/theme-provider';
import TitleBar from './components/title-bar';
import {
  SidebarInset,
  SidebarProvider,
} from './components/ui/resizable-sidebar';
import { useTauriWindow } from './hooks/use-tauri-window';

function App() {
  useTauriWindow();

  return (
    <ThemeProvider defaultTheme='dark' storageKey='vite-ui-theme'>
      <div className='flex flex-col h-screen'>
        <SidebarProvider className='flex-col'>
          <TitleBar />
          <div className='flex flex-1 min-h-0 relative w-full max-w-full'>
            <AppSidebar />
            
            <SidebarInset className="bg-sidebar">
              <div className="flex-1 flex flex-col bg-background rounded-tl-xl border-l border-t">

              </div>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </div>
    </ThemeProvider>
  );
}

export default App;
