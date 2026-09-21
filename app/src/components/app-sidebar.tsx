import { Link, useLocation } from '@tanstack/react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/resizable-sidebar';
import { NAV_GROUPS, PAGES, pageFor } from '@/lib/navigation';
import { ShortcutKeys } from './hint';

export function AppSidebar() {
  const { pathname } = useLocation();
  const active = pageFor(pathname)?.path;

  return (
    <Sidebar collapsible='icon' className='chrome'>
      <SidebarContent className='pt-1'>
        {NAV_GROUPS.map((group, i) => (
          <SidebarGroup key={group.label ?? i} className='pl-0'>
            {group.label && (
              <SidebarGroupLabel className='label-hud pl-5 text-2xs'>
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.paths.map((path) => {
                  const page = PAGES.find((p) => p.path === path)!;
                  const Icon = page.icon;
                  return (
                    <SidebarMenuItem key={path}>
                      <SidebarMenuButton
                        asChild
                        isActive={active === path}
                        size='lg'
                        tooltip={{
                          children: (
                            <span className='flex items-center gap-2'>
                              {page.label}
                              <ShortcutKeys id={page.shortcut} />
                            </span>
                          ),
                        }}
                        className='space-x-3 rounded-l-none pl-5 data-[active=true]:shadow-[inset_2px_0_0_0_var(--color-primary)]'
                      >
                        <Link to={path}>
                          <Icon className='size-5!' />
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
      <SidebarRail className='mt-3' />
    </Sidebar>
  );
}
