export function RoutesPage() {
  return (
    <>
      <header>
        <p className="eyebrow">Canonical trails</p>
        <h2>Routes</h2>
      </header>
      <div className="panel">
        <h3>Route coverage</h3>
        <p>No route, reference route, and recommended route states come from `canonical_trails`.</p>
      </div>
      <div className="panel">
        <h3>Snap thresholds</h3>
        <p>On &lt;=25 m, caution 26-50 m, away &gt;50 m.</p>
      </div>
    </>
  );
}

