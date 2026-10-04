import { UserRound } from 'lucide-react';
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from '@sunstead/ui/components/avatar';
import { initials } from '@/lib/accounts';
import { cn } from '@/lib/utils';

export interface AvatarIdentity {
  name: string;
  /** An https URL from the provider's `picture` claim. */
  picture: string | null;
  /** Initials when true, otherwise a muted person. */
  known: boolean;
  /** A dot for something waiting on you. */
  attention?: boolean;
}

/**
 * Who you are, at a glance: the provider's picture, or initials on a
 * neutral disc that follows the theme. The image only replaces the
 * initials once it has loaded (Base UI loads it off-screen first), so a
 * picture that 404s or a provider that's offline never shows as a broken
 * image.
 */
export function UserAvatar({
  who,
  size = 'default',
  className,
}: {
  who: AvatarIdentity;
  size?: 'default' | 'lg';
  className?: string;
}) {
  return (
    <Avatar size={size} className={cn('ring-1 ring-sidebar-border', className)}>
      {who.picture && <AvatarImage src={who.picture} alt='' draggable={false} />}
      <AvatarFallback
        className={cn(
          'font-medium',
          size === 'lg' ? 'text-sm' : 'text-xs',
          who.known && 'bg-sidebar-accent text-sidebar-accent-foreground',
        )}
      >
        {who.known ? initials(who.name) : <UserRound className={size === 'lg' ? 'size-5' : 'size-4'} />}
      </AvatarFallback>
      {who.attention && <AvatarBadge className='bg-warning' />}
    </Avatar>
  );
}
