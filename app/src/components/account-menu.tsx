import { Link, useLocation } from '@tanstack/react-router';
import { LogIn, LogOut, Settings, SunMoon } from 'lucide-react';
import { useTheme } from '@sunstead/ui/use-theme';
import { ThemeDef, themesOf } from '@sunstead/ui/themes';
import { Button, buttonVariants } from '@sunstead/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@sunstead/ui/components/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@sunstead/ui/components/resizable-sidebar';
import { useAccounts } from '@/hooks/use-accounts';
import { Account, openPrincipal, providerHost, roleLabel } from '@/lib/accounts';
import { signOutAndSay, useSignIn } from '@/lib/sign-in';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useNodeStore } from '@/stores/nodes';
import { Hint, ShortcutKeys } from './hint';
import { ThemeSwatch } from './theme-picker';
import { UserAvatar } from './user-avatar';

interface Identity {
  name: string;
  detail: string | null;
  picture: string | null;
  /** Signed in: initials when there's no picture. Otherwise a muted person. */
  known: boolean;
  /** Something is waiting on you: a node wants a sign-in. */
  attention: boolean;
}

function NameBlock({ who }: { who: Identity }) {
  return (
    <div className='grid min-w-0 flex-1 text-left leading-tight'>
      <span className='truncate text-sm font-medium text-sidebar-accent-foreground'>{who.name}</span>
      {who.detail && <span className='truncate text-xs text-muted-foreground'>{who.detail}</span>}
    </div>
  );
}

function identityOf(accounts: Account[], open: string | null, nodeCount: number): Identity {
  const signedIn = accounts.find((a) => a.session);
  const waiting = accounts.reduce((n, a) => n + a.waiting.length, 0);
  if (signedIn?.session) {
    const s = signedIn.session;
    return {
      name: s.name ?? s.username ?? 'Signed in',
      detail: roleLabel(signedIn) ?? s.email ?? s.username,
      picture: s.picture,
      known: true,
      attention: waiting > 0,
    };
  }
  if (accounts.length > 0) {
    return {
      name: 'Not signed in',
      detail: waiting ? `${plural(waiting, 'node')} waiting` : providerHost(accounts[0].auth.issuer),
      picture: null,
      known: false,
      attention: waiting > 0,
    };
  }
  if (open) return { name: open, detail: 'No sign-in', picture: null, known: true, attention: false };
  return { name: 'Guest', detail: nodeCount ? 'No sign-in' : 'No nodes yet', picture: null, known: false, attention: false };
}

/** One provider in the menu: who you are there, or a way in. */
function AccountHeader({ account, showProvider }: { account: Account; showProvider: boolean }) {
  const { start, busy } = useSignIn();
  const s = account.session;
  const host = providerHost(account.auth.issuer);

  if (!s) {
    return (
      <DropdownMenuGroup>
        <DropdownMenuLabel className='font-normal'>
          <p className='text-sm text-foreground'>Not signed in</p>
          <p className='text-xs text-muted-foreground'>
            {host}
            {account.waiting.length > 0 && `, ${plural(account.waiting.length, 'node')} waiting`}
          </p>
        </DropdownMenuLabel>
        <DropdownMenuItem disabled={busy} onClick={() => void start(account.auth)}>
          <LogIn /> Sign in
        </DropdownMenuItem>
      </DropdownMenuGroup>
    );
  }

  const who: Identity = {
    name: s.name ?? s.username ?? 'Signed in',
    detail: s.email ?? s.username,
    picture: s.picture,
    known: true,
    attention: false,
  };
  const role = roleLabel(account);
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className='flex items-center gap-3 py-2 font-normal'>
        <UserAvatar who={who} size='lg' />
        <div className='grid min-w-0 flex-1 leading-tight'>
          <span className='truncate text-sm font-medium text-foreground'>{who.name}</span>
          {who.detail && who.detail !== who.name && <span className='truncate text-xs'>{who.detail}</span>}
          <span className='truncate text-xs'>{[role, showProvider && host].filter(Boolean).join(' on ')}</span>
        </div>
      </DropdownMenuLabel>
    </DropdownMenuGroup>
  );
}

/**
 * The sidebar footer: who you are, and the way to settings, theme and
 * signing in or out. Modelled on Discord's user panel. Collapsed, it's just
 * the avatar.
 */
export function AccountMenu() {
  const accounts = useAccounts();
  const open = useNodeStore((s) => openPrincipal(s.meta));
  const nodeCount = useNodeStore((s) => s.nodes.length);
  const { state, isMobile, setOpenMobile } = useSidebar();
  const { themeId, setThemeId, followSystem, setFollowSystem } = useTheme();
  const { pathname } = useLocation();
  const { start, busy } = useSignIn();

  const collapsed = state === 'collapsed' && !isMobile;
  const who = identityOf(accounts, open, nodeCount);
  const signedIn = accounts.filter((a) => a.session);
  const signInTo = !signedIn.length && accounts.length === 1 ? accounts[0] : null;
  const onSettings = pathname === '/settings';
  const followed = () => isMobile && setOpenMobile(false);

  return (
    <SidebarMenu>
      <SidebarMenuItem className='flex items-center gap-1'>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size='lg'
                aria-label='Account'
                tooltip={{ children: [who.name, who.detail].filter(Boolean).join(', ') }}
                className='h-12 min-w-0 flex-1 gap-3 pl-3 data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:h-12! group-data-[collapsible=icon]:w-12! group-data-[collapsible=icon]:pl-2!'
              />
            }
          >
            <UserAvatar who={who} />
            <NameBlock who={who} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side={collapsed ? 'right' : 'top'}
            align={collapsed ? 'end' : 'start'}
            sideOffset={collapsed ? 8 : 6}
            className='w-64'
          >
            {accounts.length === 0 ? (
              <DropdownMenuGroup>
                <DropdownMenuLabel className='flex items-center gap-3 py-2 font-normal'>
                  <UserAvatar who={who} size='lg' />
                  <NameBlock who={who} />
                </DropdownMenuLabel>
              </DropdownMenuGroup>
            ) : (
              accounts.map((a, i) => (
                <div key={a.auth.issuer}>
                  {i > 0 && <DropdownMenuSeparator />}
                  <AccountHeader account={a} showProvider={accounts.length > 1} />
                </div>
              ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to='/settings' onClick={followed} />}>
              <Settings /> Settings
              <DropdownMenuShortcut>
                <ShortcutKeys id='settings' />
              </DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SunMoon /> Theme
              </DropdownMenuSubTrigger>
              {/* Portaled: inside the menu's glass it was clipped out of sight. */}
              <DropdownMenuPortal>
                <DropdownMenuSubContent className='w-48'>
                  <DropdownMenuRadioGroup
                    value={followSystem ? '' : themeId}
                    onValueChange={setThemeId}
                  >
                    {(
                      [
                        ['Dark', themesOf('dark')],
                        ['Light', themesOf('light')],
                      ] as [string, ThemeDef[]][]
                    ).map(([label, themes], i) => (
                      <DropdownMenuGroup key={label}>
                        {i > 0 && <DropdownMenuSeparator />}
                        <DropdownMenuLabel className='text-xs'>{label}</DropdownMenuLabel>
                        {themes.map((t) => (
                          <DropdownMenuRadioItem key={t.id} value={t.id}>
                            <ThemeSwatch id={t.id} /> {t.name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuGroup>
                    ))}
                  </DropdownMenuRadioGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={followSystem}
                    onCheckedChange={setFollowSystem}
                  >
                    Follow system
                  </DropdownMenuCheckboxItem>
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            {signedIn.length > 0 && <DropdownMenuSeparator />}
            {signedIn.map((a) => (
              <DropdownMenuItem
                key={a.auth.issuer}
                variant='destructive'
                onClick={() => void signOutAndSay(a.auth)}
              >
                <LogOut />{' '}
                {signedIn.length > 1
                  ? `Sign out of ${providerHost(a.auth.issuer)}`
                  : 'Sign out'}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {!collapsed &&
          (signInTo ? (
            <Button size='sm' disabled={busy} onClick={() => void start(signInTo.auth)}>
              <LogIn /> Sign in
            </Button>
          ) : (
            <Hint label='Settings' shortcut='settings' side='top'>
              <Link
                to='/settings'
                onClick={followed}
                aria-label='Settings'
                aria-current={onSettings ? 'page' : undefined}
                className={buttonVariants({
                  variant: 'ghost',
                  size: 'icon',
                  className: cn(
                    'text-muted-foreground',
                    onSettings && 'bg-sidebar-accent text-sidebar-accent-foreground',
                  ),
                })}
              >
                <Settings />
              </Link>
            </Hint>
          ))}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
