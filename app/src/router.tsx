import {
  createRouter,
  createRootRoute,
  createRoute,
  createHashHistory,
  Outlet,
  redirect,
  createBrowserHistory,
} from '@tanstack/react-router';
import { AppLayout } from './layouts/AppLayout';
import OverviewPage from './pages/overview-page';
import { NodesPage } from './pages/nodes-page';
import { ServicesPage } from './pages/services-page';
import { VolumesPage } from './pages/volumes-page';
import { NetworkPage } from './pages/network-page';
import { MonitoringPage } from './pages/monitoring-page';
import { LogsPage } from './pages/logs-page';
import { BackupsPage } from './pages/backups-page';
import { SettingsPage } from './pages/settings-page';
import { useNodeStore } from './stores/nodes';
import { getDefaultNodes } from './config';
import { isTauri } from './lib/tauri';

const rootRoute = createRootRoute({
  beforeLoad: async () => {
    const store = useNodeStore.getState();
    if (store.nodes.length === 0) {
      const defaults = await getDefaultNodes();
      for (const node of defaults) {
        await store.addNode(node.url);
      }
    }
  },
  component: () => (
    <>
      <AppLayout>
        <Outlet />
      </AppLayout>
    </>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/overview' });
  },
});

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/overview',
  component: () => <OverviewPage />,
});

const nodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nodes',
  component: () => <NodesPage />,
});

const servicesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/services',
  component: () => <ServicesPage />,
});

const volumesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/volumes',
  component: () => <VolumesPage />,
});

const networkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/network',
  component: () => <NetworkPage />,
});

const monitoringRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/monitoring',
  component: () => <MonitoringPage />,
});

const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: () => <LogsPage />,
});

const backupsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backups',
  component: () => <BackupsPage />,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: () => <SettingsPage />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  dashboardRoute,
  nodesRoute,
  servicesRoute,
  volumesRoute,
  networkRoute,
  monitoringRoute,
  logsRoute,
  backupsRoute,
  settingsRoute,
]);

// Hash history for Tauri — works fine in browser too
const history = isTauri() ? createHashHistory() : createBrowserHistory();

export const router = createRouter({ routeTree, history: history });

// Global type registration for full type inference
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
