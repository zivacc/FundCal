// FullscreenChart — modal overlay that shows the fee chart edge-to-edge.
// Used by pressing the ⤢ button on the chart panel.

function FullscreenChart({ funds, visible, maxDay, setMaxDay, discount, setDiscount, S, onClose }) {
  const [localVisible, setLocalVisible] = useState(visible);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => setLocalVisible(visible), [visible]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayed = funds.filter(f => localVisible[f.code]);

  return (
    <div style={{
      position: 'absolute', inset: 0, background: S.bg, zIndex: 50,
      display: 'flex', flexDirection: 'column',
      animation: 'fcFadeIn .22s ease-out',
    }}>
      <style>{`
        @keyframes fcFadeIn { from { opacity: 0; transform: scale(.98); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      {/* header */}
      <div style={{
        height: 56, padding: '0 28px', borderBottom: `1px solid ${S.rule}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: S.bgRaised,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ fontSize: 11, fontFamily: S.mono, color: S.ink3, letterSpacing: 2 }}>
            全屏图表
          </div>
          <div style={{ width: 1, height: 16, background: S.rule }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: S.ink }}>
            累计费率 × 持有天数
          </div>
          <div style={{ fontSize: 11, fontFamily: S.mono, color: S.ink3 }}>
            {displayed.length} / {funds.length} 只
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 3, background: S.bgSunk, padding: 3, borderRadius: 6 }}>
            {[60, 180, 365, 730, 1095].map(d => (
              <button key={d} onClick={() => setMaxDay(d)} style={{
                padding: '4px 10px', fontSize: 11.5, fontFamily: S.mono,
                border: 'none',
                background: maxDay === d ? S.bgRaised : 'transparent',
                color: maxDay === d ? S.ink : S.ink2,
                borderRadius: 4, cursor: 'pointer',
                boxShadow: maxDay === d ? `0 1px 2px rgba(0,0,0,.05)` : 'none',
              }}>{d}d</button>
            ))}
          </div>
          <select value={discount} onChange={e => setDiscount(+e.target.value)} style={{
            padding: '5px 8px', fontSize: 11.5, fontFamily: S.mono,
            border: `1px solid ${S.rule}`, background: S.bgRaised,
            color: S.ink, borderRadius: 5, cursor: 'pointer',
          }}>
            <option value="1">原价</option>
            <option value="0.1">一折</option>
            <option value="0.01">0.1折</option>
            <option value="0">免申购</option>
          </select>
          <div style={{ width: 1, height: 20, background: S.rule }} />
          <button onClick={onClose} style={{
            padding: '6px 10px', fontSize: 12, fontFamily: S.mono,
            background: 'transparent', border: `1px solid ${S.rule}`,
            color: S.ink, borderRadius: 5, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
            退出 · ESC
          </button>
        </div>
      </div>

      {/* chart body */}
      <div style={{
        flex: 1, padding: '24px 32px', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          <FeeChart
            funds={displayed} width={1360} height={740}
            theme={S.chart} maxDay={maxDay} discount={discount}
          />
        </div>

        <FundListPanel
          funds={funds} visible={localVisible} setVisible={setLocalVisible}
          open={panelOpen} setOpen={setPanelOpen} S={S}
          style={{ right: 40, top: 24 }}
        />

        {/* stats footer floating bottom-left */}
        <div style={{
          position: 'absolute', left: 40, bottom: 40,
          background: S.bgRaised, border: `1px solid ${S.rule}`, borderRadius: 10,
          padding: '12px 16px', boxShadow: S.shadow,
          display: 'flex', gap: 24,
        }}>
          <div>
            <div style={{ fontSize: 10, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.2, marginBottom: 2 }}>
              MAX 天数
            </div>
            <div style={{ fontSize: 22, fontFamily: S.mono, fontWeight: 600, color: S.ink }}>
              {maxDay}
            </div>
          </div>
          <div style={{ width: 1, background: S.rule }} />
          <div>
            <div style={{ fontSize: 10, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.2, marginBottom: 2 }}>
              申购折扣
            </div>
            <div style={{ fontSize: 22, fontFamily: S.mono, fontWeight: 600, color: S.accent }}>
              {discount === 0 ? '免' : `${(discount * 10).toFixed(1)}折`}
            </div>
          </div>
          <div style={{ width: 1, background: S.rule }} />
          <div>
            <div style={{ fontSize: 10, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.2, marginBottom: 2 }}>
              曲线交叉
            </div>
            <div style={{ fontSize: 22, fontFamily: S.mono, fontWeight: 600, color: S.warm }}>
              {Math.max(0, displayed.length * (displayed.length - 1) / 2 - 1)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.FullscreenChart = FullscreenChart;
