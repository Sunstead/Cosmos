import { Copy, HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@sunstead/ui/components/popover';
import { Button } from '@sunstead/ui/components/button';
import { copyText } from '@/lib/clipboard';
import { SetupInfo } from '@/lib/setup';

/** A `?` button revealing the one thing needed to enable a feature. */
export function SetupHint({ info, label = 'How to enable' }: { info: SetupInfo; label?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='icon-xs'
            aria-label={label}
            className='text-muted-foreground'
          />
        }
      >
        <HelpCircle />
      </PopoverTrigger>
      <PopoverContent className='w-80 space-y-3 text-sm'>
        <p>{info.summary}</p>
        {info.snippet && (
          <div className='space-y-1'>
            {info.file && <p className='text-xs text-muted-foreground'>{info.file}</p>}
            <div className='selectable flex items-start gap-2 rounded-md bg-muted p-2 font-mono text-xs'>
              <pre className='flex-1 whitespace-pre-wrap break-all'>{info.snippet}</pre>
              <Button
                variant='ghost'
                size='icon-xs'
                aria-label='Copy'
                onClick={() => void copyText(info.snippet!, 'Copied to clipboard')}
              >
                <Copy />
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
