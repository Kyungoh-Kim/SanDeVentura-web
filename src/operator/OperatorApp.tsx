import { useEffect, useState } from 'react';

import { DiscoveryPage } from './pages/DiscoveryPage';
import { MountainsPage } from './pages/MountainsPage';
import { OverviewPage } from './pages/OverviewPage';
import { QualityPage } from './pages/QualityPage';
import { RoutesPage } from './pages/RoutesPage';
import { SessionsPage } from './pages/SessionsPage';

const NAV = [
  { id: 'overview',   label: 'Overview' },
  { id: 'routes',     label: 'Routes' },
  { id: 'sessions',   label: 'Sessions' },
  { id: 'quality',    label: 'Quality' },
  { id: 'mountains',  label: 'Mountains' },
  { id: 'discovery',  label: 'Discovery' },
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
          <MountainIcon />
          SanDeVentura
        </div>
        <nav className="sidebar-nav">
          {NAV.map(({ id, label }) => (
            <a
              key={id}
              href={`#${id}`}
              className={active === id ? 'active' : ''}
              onClick={(e) => { e.preventDefault(); navigate(id); }}
            >
              <NavIcon id={id} />
              {label}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-role">Operator only</div>
          <div className="sidebar-user">
            <span className="avatar">A</span>
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
          <span className="avatar">A</span>
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

function MountainIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M3 20L9 8l4 5 3-4 5 11H3Z"
        fill="rgba(255,255,255,0.2)"
        stroke="rgba(255,255,255,0.88)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavIcon({ id }: { id: string }) {
  if (id === 'overview') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    );
  }
  if (id === 'routes') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17c3-3 6-5 9-5s6 2 9-2" />
        <circle cx="5" cy="19" r="2" /><circle cx="19" cy="10" r="2" />
      </svg>
    );
  }
  if (id === 'sessions') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
      </svg>
    );
  }
  if (id === 'quality') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    );
  }
  if (id === 'mountains') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20L9 8l4 5 3-4 5 11H3Z" />
      </svg>
    );
  }
  if (id === 'discovery') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
        <line x1="11" y1="8" x2="11" y2="14" /><line x1="8" y1="11" x2="14" y2="11" />
      </svg>
    );
  }
  return null;
}
