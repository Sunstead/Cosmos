import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { cn } from '@/lib/utils';
import { Hint } from './hint';

export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <Hint label={`Switch to ${next} theme`} shortcut='theme'>
      <Button variant='ghost' size='icon' className={cn('text-muted-foreground', className)} onClick={toggleTheme} aria-label='Toggle theme'>
        {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
      </Button>
    </Hint>
  );
}
