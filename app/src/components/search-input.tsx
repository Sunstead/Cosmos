import { Search, X } from 'lucide-react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/**
 * The page search field. `/` focuses it from anywhere on the page (see
 * CommandHost), and Escape clears it.
 */
export function SearchInput({
  value,
  onChange,
  placeholder = 'Search',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <InputGroup className={cn('w-56', className)}>
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupInput
        data-page-search
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && value) {
            e.stopPropagation();
            onChange('');
          }
        }}
      />
      <InputGroupAddon align='inline-end'>
        {value ? (
          <InputGroupButton size='icon-xs' aria-label='Clear search' onClick={() => onChange('')}>
            <X />
          </InputGroupButton>
        ) : (
          <Kbd>/</Kbd>
        )}
      </InputGroupAddon>
    </InputGroup>
  );
}
