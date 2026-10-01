import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from 'lucide-react';
import { useTheme } from '@/hooks/use-theme';

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved.scheme}
      className='toaster group'
      icons={{
        success: <CircleCheckIcon className='size-4 text-success' />,
        info: <InfoIcon className='size-4' />,
        warning: <TriangleAlertIcon className='size-4 text-warning' />,
        error: <OctagonXIcon className='size-4 text-error' />,
        loading: <Loader2Icon className='size-4 animate-spin' />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: 'glass' } }}
      {...props}
    />
  );
};

export { Toaster };
