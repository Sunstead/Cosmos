import { useEffect, useRef, useState } from 'react';
import { SidebarTrigger } from '@/components/ui/resizable-sidebar';
import { Button } from '@/components/ui/button';

const isTauri = () => '__TAURI_INTERNALS__' in window;

export default function TitleBar() {
  const [isMac, setIsMac] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const appWindowRef = useRef<any>(null);

  useEffect(() => {
    if (!isTauri()) return;
    setIsDesktop(true);

    let unlisten: (() => void) | null = null;

    const init = async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const appWindow = getCurrentWindow();
      appWindowRef.current = appWindow;

      setIsMaximized(await appWindow.isMaximized());
      setIsFullscreen(await appWindow.isFullscreen());

      unlisten = await appWindow.onResized(async () => {
        setIsMaximized(await appWindow.isMaximized());
        setIsFullscreen(await appWindow.isFullscreen());
      });
    };

    init();

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    import('@tauri-apps/plugin-os').then(({ platform }) => {
      setIsMac(platform() === 'macos');
    });
  }, []);

  const appWindow = appWindowRef.current;

  return (
    <header className='bg-sidebar w-full h-12 min-h-9 draggable relative flex items-center'>
      <div data-tauri-drag-region className='size-full absolute inset-0' />

      <div className='flex items-center z-0 w-max h-max'>
        <div className='flex items-center pl-2 gap-x-2 select-none'>
          {isDesktop && isMac ? (
            <>
              {!isFullscreen && <span className='w-16' />}
              <SidebarTrigger className='size-10 no-drag z-50 select-all' />
            </>
          ) : (
            <SidebarTrigger className='size-10 no-drag z-50 select-all' />
          )}
        </div>
      </div>

      {isDesktop && !isMac && (
        <div className='flex ml-auto select-all text-muted-foreground'>
          {/* Minimize */}
          <Button
            className='flex items-center justify-center rounded-none w-12 h-12 select-all z-50 no-drag'
            variant='ghost'
            onClick={() => appWindow?.minimize()}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 16 16'
              strokeWidth='1.5'
              stroke='currentColor'
              fill='none'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='1.5' y1='8' x2='14.5' y2='8' />
            </svg>
          </Button>

          {/* Maximize / Restore */}
          <Button
            className='flex items-center justify-center rounded-none w-12 h-12 select-all z-50 no-drag'
            variant='ghost'
            onClick={() => appWindow?.toggleMaximize()}
          >
            {isMaximized ? (
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='16'
                height='16'
                viewBox='0 0 16 16'
              >
                <rect
                  style={{
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.5,
                    strokeLinejoin: 'round',
                  }}
                  x='1.5'
                  y='4.5'
                  width='10'
                  height='10'
                  ry='2'
                />
                <path
                  style={{
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.5,
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                  }}
                  d='M 5.5 1.5 h 5 A 4 4 0 0 1 14.5 5.5 v 6'
                />
              </svg>
            ) : (
              <svg
                xmlns='http://www.w3.org/2000/svg'
                width='16'
                height='16'
                viewBox='0 0 16 16'
              >
                <rect
                  style={{
                    fill: 'none',
                    stroke: 'currentColor',
                    strokeWidth: 1.5,
                    strokeLinejoin: 'round',
                  }}
                  x='1.5'
                  y='1.5'
                  width='13'
                  height='13'
                  ry='3'
                />
              </svg>
            )}
          </Button>

          {/* Close */}
          <Button
            className='flex items-center justify-center rounded-none w-12 h-12 select-all z-50 no-drag'
            variant='ghost'
            onClick={() => appWindow?.close()}
          >
            <svg
              xmlns='http://www.w3.org/2000/svg'
              width='16'
              height='16'
              viewBox='0 0 16 16'
              strokeWidth='1.5'
              stroke='currentColor'
              fill='none'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <line x1='2.5' y1='2.5' x2='13.5' y2='13.5' />
              <line x1='13.5' y1='2.5' x2='2.5' y2='13.5' />
            </svg>
          </Button>
        </div>
      )}
    </header>
  );
}
