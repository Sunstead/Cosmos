import { Link, useLocation } from '@tanstack/react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/resizable-sidebar';
import { NAV_GROUPS, PAGES, pageFor } from '@/lib/navigation';
import { ShortcutKeys } from './hint';
import { AccountMenu } from './account-menu';

// Rounded on every side and inset from the edges; the page you're on is a
// fill, hover a lighter one. Collapsed, each button is centred in the rail.
const ITEM =
  'gap-2.5 rounded-md px-3 text-muted-foreground hover:bg-sidebar-accent/60 group-data-[collapsible=icon]:mx-auto';

export function AppSidebar() {
  const { pathname } = useLocation();
  const active = pageFor(pathname)?.path;
  const { isMobile, setOpenMobile } = useSidebar();
  // On a phone the sidebar is a sheet over the page; following a link closes it.
  const followed = () => isMobile && setOpenMobile(false);

  return (
    <Sidebar collapsible='icon' className='chrome'>
      <SidebarContent className='gap-0 pt-1 in-data-[mobile=true]:pt-3'>
        {NAV_GROUPS.map((group, i) => (
          <SidebarGroup key={group.label ?? i} className='px-2 py-1.5'>
            {group.label && (
              // Lined up with the item icons (the buttons' px-3).
              <SidebarGroupLabel className='label-hud h-7 pl-3 text-2xs text-sidebar-foreground/60 group-data-[collapsible=icon]:-mt-7'>
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className='gap-0.5'>
                {group.paths.map((path) => {
                  const page = PAGES.find((p) => p.path === path)!;
                  const Icon = page.icon;
                  return (
                    <SidebarMenuItem key={path}>
                      <SidebarMenuButton
                        asChild
                        isActive={active === path}
                        tooltip={{
                          children: (
                            <span className='flex items-center gap-2'>
                              {page.label}
                              <ShortcutKeys id={page.shortcut} />
                            </span>
                          ),
                        }}
                        className={ITEM}
                      >
                        <Link to={path} onClick={followed}>
                          <Icon />
                          <span>{page.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <AccountMenu />
      </SidebarFooter>
      <SidebarRail className='mt-3' />
    </Sidebar>
  );
}
