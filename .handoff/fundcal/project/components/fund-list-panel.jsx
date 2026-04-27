// FundListPanel — separate, reusable floating tab for showing/hiding funds on the chart.
// Can be docked (expanded) or collapsed. Sits on the right edge of a chart container.

function FundListPanel({ funds, visible, setVisible, open, setOpen, S, style = {} }) {
  const visibleCount = funds.filter(f => visible[f.code]).length;
  const allOn = () => setVisible(Object.fromEntries(funds.map(f => [f.code, true])));
  const allOff = () => setVisible(Object.fromEntries(funds.map(f => [f.code, false])));

  return (
    <div style={{
      position: 'absolute', width: open ? 240 : 40,
      transition: 'width .28s cubic-bezier(.2,.7,.3,1)',
      background: S.bgRaised, border: `1px solid ${S.rule}`,
      borderRadius: 10, overflow: 'hidden', zIndex: 5,
      boxShadow: S.shadow,
      ...style,
    }}>
      <div onClick={() => setOpen(!open)} style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px',
        borderBottom: open ? `1px solid ${S.rule}` : 'none', cursor: 'pointer',
        justifyContent: open ? 'space-between' : 'center',
        userSelect: 'none',
      }}>
        {open ? (
          <>
            <span style={{
              fontSize: 10.5, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.2,
            }}>
              显示基金 · {visibleCount}/{funds.length}
            </span>
            <span style={{ color: S.ink3, fontSize: 13, transform: 'rotate(0deg)' }}>›</span>
          </>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={S.ink2} strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
        )}
      </div>
      {open && (
        <>
          <div style={{ padding: '6px 4px', maxHeight: 320, overflowY: 'auto' }}>
            {funds.map(f => (
              <div key={f.code} onClick={() => setVisible({ ...visible, [f.code]: !visible[f.code] })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                  borderRadius: 6, cursor: 'pointer', opacity: visible[f.code] ? 1 : 0.4,
                  transition: 'background .12s, opacity .18s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = S.bgSunk}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{
                  width: 11, height: 11, borderRadius: 2.5,
                  background: visible[f.code] ? f.color : 'transparent',
                  border: `1.5px solid ${f.color}`, flexShrink: 0,
                }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: 11.5, fontWeight: 500, color: S.ink,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {f.name}
                  </div>
                  <div style={{ fontSize: 10, fontFamily: S.mono, color: S.ink3, marginTop: 1 }}>
                    {f.code}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{
            borderTop: `1px solid ${S.rule}`, padding: '6px 10px',
            display: 'flex', gap: 14,
            fontSize: 10.5, fontFamily: S.mono, color: S.ink3,
          }}>
            <span style={{ cursor: 'pointer' }} onClick={allOn}>全部显示</span>
            <span style={{ cursor: 'pointer' }} onClick={allOff}>全部隐藏</span>
          </div>
        </>
      )}
    </div>
  );
}

window.FundListPanel = FundListPanel;
