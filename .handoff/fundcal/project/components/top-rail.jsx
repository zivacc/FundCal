// Shared top rail used across all 4 pages — tab nav that Ziva loved.

function TopRail({ S, activePage, setActivePage, darkMode, setDarkMode, extra }) {
  const pages = [
    { key: 'calc', label: '计算器' },
    { key: 'list', label: '基金列表' },
    { key: 'index', label: '指数页' },
    { key: 'stats', label: '统计' },
  ];
  return (
    <div style={{
      height: 52, borderBottom: `1px solid ${S.rule}`,
      display: 'flex', alignItems: 'center', padding: '0 28px',
      justifyContent: 'space-between', background: S.bg,
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 5, background: S.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: S.bg, fontSize: 11, fontWeight: 700, letterSpacing: -0.5,
            fontFamily: S.serif,
          }}>F</div>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.2, color: S.ink }}>
            FundCal
          </div>
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          {pages.map(p => (
            <div key={p.key} onClick={() => setActivePage(p.key)} style={{
              padding: '6px 12px', fontSize: 13,
              color: activePage === p.key ? S.ink : S.ink2,
              background: activePage === p.key ? S.accentBg : 'transparent',
              borderRadius: 6, fontWeight: activePage === p.key ? 500 : 400,
              cursor: 'pointer', transition: 'all .12s',
            }}>
              {p.label}
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12, color: S.ink3 }}>
        {extra}
        <span style={{ fontFamily: S.mono }}>v2.4.0</span>
        <div style={{ width: 1, height: 14, background: S.rule }} />
        <span>数据 2026-04-19</span>
        <button onClick={() => setDarkMode(!darkMode)} title={darkMode ? '切换到浅色' : '切换到深色'} style={{
          marginLeft: 4, padding: '4px 8px', border: `1px solid ${S.rule}`,
          background: S.bgRaised, color: S.ink2, borderRadius: 5, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: S.mono,
        }}>
          {darkMode
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          }
          {darkMode ? 'Light' : 'Dark'}
        </button>
      </div>
    </div>
  );
}

// Shared button helpers
const btnSec = (S) => ({
  padding: '7px 14px', fontSize: 12.5, border: `1px solid ${S.rule}`,
  background: S.bgRaised, color: S.ink, borderRadius: 6, cursor: 'pointer',
  fontFamily: 'inherit',
});
const btnPri = (S) => ({
  padding: '7px 14px', fontSize: 12.5, border: 'none',
  background: S.ink, color: S.bg, borderRadius: 6, cursor: 'pointer',
  fontFamily: 'inherit', fontWeight: 500,
});
const chipBtn = (S, active) => ({
  padding: '4px 10px', fontSize: 12, fontFamily: S.mono,
  border: `1px solid ${active ? S.ink : S.rule}`,
  background: active ? S.ink : S.bgRaised,
  color: active ? S.bg : S.ink2,
  borderRadius: 5, cursor: 'pointer',
});

window.TopRail = TopRail;
window.btnSec = btnSec;
window.btnPri = btnPri;
window.chipBtn = chipBtn;
