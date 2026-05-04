import { OverviewPage } from './pages/OverviewPage';
import { QualityPage } from './pages/QualityPage';
import { RoutesPage } from './pages/RoutesPage';
import { SessionsPage } from './pages/SessionsPage';

const pages = [
  { label: 'Overview', component: <OverviewPage /> },
  { label: 'Routes', component: <RoutesPage /> },
  { label: 'Sessions', component: <SessionsPage /> },
  { label: 'Quality', component: <QualityPage /> },
];

export function OperatorApp() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <h1>SanDeVentura</h1>
        <span className="badge">Operator only</span>
        <nav>
          {pages.map((page) => (
            <a href={`#${page.label.toLowerCase()}`} key={page.label}>
              {page.label}
            </a>
          ))}
        </nav>
      </aside>
      <section className="content">
        {pages.map((page) => (
          <section className="page-section" id={page.label.toLowerCase()} key={page.label}>
            {page.component}
          </section>
        ))}
      </section>
    </main>
  );
}

