import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import { Hint } from './hint';

export function ThemeToggle({ variant = 'ghost' }: { variant?: 'ghost' | 'outline' }) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const next = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <Hint label={`Switch to ${next} theme`} shortcut='theme'>
      <Button variant={variant} size='icon' onClick={toggleTheme} aria-label='Toggle theme'>
        {resolvedTheme === 'dark' ? <Moon /> : <Sun />}
      </Button>
    </Hint>
  );
}
