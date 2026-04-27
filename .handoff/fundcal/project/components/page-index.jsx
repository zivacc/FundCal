// Page: 指数页 (Index Page) — hero search, quiet-light theme, no italic.

function PageIndex({ S }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('000300');
  const [hoverCat, setHoverCat] = useState(null);

  const filtered = window.INDEX_DATA.filter(ix => {
    if (!query) return true;
    const q = query.toLowerCase();
    return ix.name.includes(query) || ix.code.toLowerCase().includes(q) || ix.pinyin.includes(q);
  });

  const categories = ['全部', '宽基', '行业', '商品', '海外'];
  const selectedIx = window.INDEX_DATA.find(i => i.code === selected);

  return (
    <div style={{
      flex: 1, position: 'relative', overflow: 'auto', background: S.bg,
    }}>
      {/* subtle warm radial accents */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none',
        backgroundImage: S.mode === 'dark'
          ? 'radial-gradient(circle at 20% 25%, rgba(142,166,255,0.06) 0%, transparent 40%), radial-gradient(circle at 85% 75%, rgba(214,149,89,0.05) 0%, transparent 40%)'
          : 'radial-gradient(circle at 20% 25%, rgba(59,91,219,0.04) 0%, transparent 40%), radial-gradient(circle at 85% 75%, rgba(184,115,45,0.04) 0%, transparent 40%)',
      }} />

      {/* HERO SEARCH */}
      <div style={{
        padding: '64px 32px 40px',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{
          fontSize: 11, fontFamily: S.mono, color: S.accent,
          letterSpacing: 3, marginBottom: 14,
        }}>
          INDEX · TRACKER · COMPARE
        </div>
        <div style={{
          fontFamily: S.serif, fontSize: 52, fontWeight: 700,
          letterSpacing: -1.5, textAlign: 'center', lineHeight: 1.05,
          marginBottom: 14, color: S.ink,
        }}>
          按<span style={{
            color: S.accent, margin: '0 4px',
            borderBottom: `3px solid ${S.accent}`, paddingBottom: 2,
          }}> 指数 </span>选基金
        </div>
        <div style={{
          fontSize: 15, color: S.ink2, textAlign: 'center',
          maxWidth: 560, marginBottom: 38,
        }}>
          输入你关心的跟踪标的,比较所有挂钩该指数的基金的费率、规模与业绩
        </div>

        {/* the impressive search */}
        <div style={{ width: 880, position: 'relative' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, padding: '18px 22px',
            background: S.bgRaised, border: `1.5px solid ${query ? S.accent : S.rule}`,
            borderRadius: 14,
            boxShadow: query
              ? `0 0 0 5px ${S.accentBg}, 0 20px 48px rgba(0, 0, 0, 0.08)`
              : S.shadow,
            transition: 'all .25s cubic-bezier(.2,.7,.3,1)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke={query ? S.accent : S.ink3} strokeWidth="2"
              style={{ transition: 'stroke .25s' }}>
              <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="沪深300 · hs300 · 黄金9999 · 科创50 · hstec …"
              style={{
                flex: 1, border: 'none', outline: 'none', background: 'transparent',
                fontSize: 20, fontFamily: S.serif, color: S.ink, letterSpacing: -0.3,
              }} />
            <div style={{ display: 'flex', gap: 6 }}>
              {['宽基', '行业', '商品', '海外'].map(t => (
                <span key={t} onClick={() => setQuery(t === query ? '' : t)} style={{
                  fontSize: 11, fontFamily: S.mono, padding: '4px 9px', borderRadius: 5,
                  border: `1px solid ${S.rule}`,
                  color: query === t ? S.bg : S.ink2,
                  background: query === t ? S.ink : S.bgSunk,
                  cursor: 'pointer', letterSpacing: 1,
                }}>{t}</span>
              ))}
            </div>
            <div style={{ width: 1, height: 22, background: S.rule }} />
            <span style={{
              fontFamily: S.mono, fontSize: 10.5, color: S.ink3,
              padding: '4px 7px', border: `1px solid ${S.rule}`, borderRadius: 5,
            }}>⌘ K</span>
          </div>

          {/* dropdown peek */}
          <div style={{
            marginTop: 10, background: S.bgRaised, border: `1px solid ${S.rule}`,
            borderRadius: 12, overflow: 'hidden', boxShadow: S.shadow,
          }}>
            <div style={{
              padding: '8px 18px', background: S.bgSunk,
              borderBottom: `1px solid ${S.rule}`,
              fontSize: 10.5, fontFamily: S.mono, color: S.ink3, letterSpacing: 2,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span>{query ? `匹配 ${filtered.length} 个指数` : '热门指数 · TOP 6'}</span>
              <span>按 ↑↓ 选择 · ⏎ 确认</span>
            </div>
            <div>
              {(query ? filtered : window.INDEX_DATA.slice(0, 6)).map((ix, i, arr) => (
                <div key={ix.code} onClick={() => setSelected(ix.code)} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '12px 18px',
                  borderBottom: i < arr.length - 1 ? `1px solid ${S.rule}` : 'none',
                  cursor: 'pointer',
                  background: selected === ix.code ? S.accentBg : 'transparent',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = selected === ix.code ? S.accentBg : S.bgSunk}
                onMouseLeave={e => e.currentTarget.style.background = selected === ix.code ? S.accentBg : 'transparent'}>
                  <span style={{ fontFamily: S.mono, fontSize: 11, color: S.ink3, width: 60 }}>{ix.code}</span>
                  <span style={{
                    fontFamily: S.serif, fontSize: 17, fontWeight: 600,
                    flex: 1, color: S.ink,
                  }}>
                    {ix.name}
                  </span>
                  <span style={{
                    fontSize: 10.5, fontFamily: S.mono, color: S.ink3,
                    padding: '2px 8px', border: `1px solid ${S.rule}`, borderRadius: 4,
                  }}>{ix.category}</span>
                  <span style={{ fontSize: 12.5, fontFamily: S.mono, color: S.ink2 }}>
                    {ix.count} <span style={{ color: S.ink3 }}>只基金</span>
                  </span>
                  <span style={{
                    fontSize: 14,
                    color: selected === ix.code ? S.accent : S.ink3,
                  }}>›</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* category chips */}
        <div style={{ marginTop: 28, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{
            fontSize: 11, fontFamily: S.mono, color: S.ink3, letterSpacing: 2,
          }}>分类浏览 ›</span>
          {categories.map(c => (
            <div key={c}
              onMouseEnter={() => setHoverCat(c)}
              onMouseLeave={() => setHoverCat(null)}
              style={{
                padding: '5px 13px', fontSize: 12, borderRadius: 16,
                border: `1px solid ${hoverCat === c ? S.ink : S.rule}`,
                background: hoverCat === c ? S.ink : S.bgRaised,
                color: hoverCat === c ? S.bg : S.ink2,
                cursor: 'pointer', transition: 'all .15s',
              }}>{c}</div>
          ))}
        </div>
      </div>

      {/* selected index preview footer */}
      {selectedIx && (
        <div style={{
          marginTop: 40, background: S.bgRaised, borderTop: `1px solid ${S.rule}`,
          padding: '20px 32px', display: 'flex', alignItems: 'center', gap: 28,
          position: 'relative', zIndex: 1,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              fontSize: 10.5, fontFamily: S.mono, color: S.ink3, letterSpacing: 2,
            }}>选中</div>
            <div>
              <div style={{
                fontFamily: S.serif, fontSize: 22, fontWeight: 700,
                letterSpacing: -0.3, color: S.ink,
              }}>
                {selectedIx.name}
              </div>
              <div style={{
                fontSize: 11, fontFamily: S.mono, color: S.ink3, marginTop: 2,
              }}>
                {selectedIx.code} · {selectedIx.category} · 跟踪基金 {selectedIx.count} 只
              </div>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', gap: 10, overflow: 'hidden' }}>
            {['ETF', 'ETF联接A', 'ETF联接C', '增强策略', 'LOF', 'QDII'].map((t, i) => (
              <div key={t} style={{
                padding: '8px 14px', border: `1px solid ${S.rule}`, borderRadius: 8,
                fontSize: 11.5, fontFamily: S.mono, color: S.ink2, background: S.bgSunk,
              }}>
                {t} <span style={{ color: S.accent, fontWeight: 600, marginLeft: 4 }}>
                  {Math.round(selectedIx.count * [0.15, 0.25, 0.22, 0.18, 0.12, 0.08][i])}
                </span>
              </div>
            ))}
          </div>
          <button style={{
            padding: '10px 22px', background: S.ink, color: S.bg, border: 'none',
            borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            查看 {selectedIx.count} 只基金 <span>→</span>
          </button>
        </div>
      )}
    </div>
  );
}

window.PageIndex = PageIndex;
