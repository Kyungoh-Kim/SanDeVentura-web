import { useEffect, useState } from 'react';
import {
  Activity,
  CircleUser,
  LayoutDashboard,
  List,
  Mountain,
  Route,
  Search,
} from 'lucide-react';

import { DiscoveryPage } from './pages/DiscoveryPage';
import { MountainsPage } from './pages/MountainsPage';
import { OverviewPage } from './pages/OverviewPage';
import { QualityPage } from './pages/QualityPage';
import { RoutesPage } from './pages/RoutesPage';
import { SessionsPage } from './pages/SessionsPage';

const NAV = [
  { id: 'overview',   label: 'Overview',  icon: LayoutDashboard },
  { id: 'routes',     label: 'Routes',    icon: Route },
  { id: 'sessions',   label: 'Sessions',  icon: List },
  { id: 'quality',    label: 'Quality',   icon: Activity },
  { id: 'mountains',  label: 'Mountains', icon: Mountain },
  { id: 'discovery',  label: 'Discovery', icon: Search },
] as const;

type PageId = (typeof NAV)[number]['id'];

function getInitialPage(): PageId {
  const hash = window.location.hash.replace('#', '') as PageId;
  return NAV.some((n) => n.id === hash) ? hash : 'overview';
}

export function OperatorApp() {
  const [active, setActive] = useState<PageId>(getInitialPage);
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => {
      const id = window.location.hash.replace('#', '') as PageId;
      if (NAV.some((n) => n.id === id)) setActive(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  function navigate(id: PageId) {
    setActive(id);
    window.location.hash = id;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <Mountain size={22} strokeWidth={1.8} />
          SanDeVentura
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={active === id ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); navigate(id); }}
            >
              <Icon size={16} strokeWidth={1.9} />
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-role">Operator only</div>
          <div className="sidebar-user">
            <span className="avatar"><CircleUser size={15} strokeWidth={2} /></span>
            Admin
          </div>
        </div>
      </aside>

      <div className="content-wrapper">
        <header className="top-bar">
          <span className="online-pill">
            <span className="online-dot" />
            Online
          </span>
          <span className="avatar"><CircleUser size={15} strokeWidth={2} /></span>
        </header>

        <main className="content">
          {/* All pages remain mounted so data fetches run on load */}
          <div style={{ display: active === 'overview' ? 'block' : 'none' }}>
            <div className="page-section"><OverviewPage /></div>
          </div>
          <div style={{ display: active === 'routes' ? 'block' : 'none' }}>
            <div className="page-section"><RoutesPage selectedRouteId={selectedRouteId} onSelectRoute={setSelectedRouteId} /></div>
          </div>
          <div style={{ display: active === 'sessions' ? 'block' : 'none' }}>
            <div className="page-section"><SessionsPage /></div>
          </div>
          <div style={{ display: active === 'quality' ? 'block' : 'none' }}>
            <div className="page-section"><QualityPage selectedRouteId={selectedRouteId} onSelectRoute={setSelectedRouteId} /></div>
          </div>
          <div style={{ display: active === 'mountains' ? 'block' : 'none' }}>
            <div className="page-section"><MountainsPage /></div>
          </div>
          <div style={{ display: active === 'discovery' ? 'block' : 'none' }}>
            <div className="page-section"><DiscoveryPage /></div>
          </div>
        </main>
      </div>
    </div>
  );
}
