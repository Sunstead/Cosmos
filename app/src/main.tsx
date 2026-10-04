import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { router } from './router';
import { applyPlatform, isDesktop } from './lib/platform';
import { ThemeProvider } from '@sunstead/ui/theme-provider';
import { THEME_ALIASES } from './lib/theme-aliases';
import { TooltipProvider } from '@sunstead/ui/components/tooltip';
import { Toaster } from '@sunstead/ui/components/sonner';
import './App.css';

// Before render, so platform-specific CSS applies to the first frame.
const platform = applyPlatform();

// The webview's own context menu (Reload, Inspect) doesn't belong in a
// packaged app. Keep it where copy/paste is useful.
if (isDesktop(platform) && import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, [contenteditable], .selectable')) return;
    e.preventDefault();
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 1000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider app='cosmos' aliases={THEME_ALIASES}>
      <TooltipProvider delay={300}>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
        <Toaster position='bottom-right' />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
