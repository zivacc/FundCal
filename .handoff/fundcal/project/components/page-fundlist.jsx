// Page: 基金列表 (Fund List) — full directory, table-like spec sheet for every fund.
// Filters on the left rail, sortable table on the right.

function PageFundList({ S }) {
  const [q, setQ] = useState('');
  const [sortBy, setSortBy] = useState('year1');
  const [trackFilter, setTrackFilter] = useState('全部');
  const [companyFilter, setCompanyFilter] = useState('全部');

  const tracks = ['全部', ...new Set(window.FUND_DATA.map(f => f.track))];
  const companies = ['全部', ...new Set(window.FUND_DATA.map(f => f.company))];

  const rows = window.FUND_DATA
    .filter(f => !q || f.name.includes(q) || f.code.includes(q))
    .filter(f => trackFilter === '全部' || f.track === trackFilter)
    .filter(f => companyFilter === '全部' || f.company === companyFilter)
    .map(f => ({
      ...f,
      annual: f.mgmtFee + f.custodyFee + f.serviceFee,
      year1: window.computeCumCost(f, 365, f.buyDiscount),
      year2: window.computeCumCost(f, 730, f.buyDiscount),
      day30: window.computeCumCost(f, 30, f.buyDiscount),
    }))
    .sort((a, b) => {
      if (sortBy === 'code') return a.code.localeCompare(b.code);
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return a[sortBy] - b[sortBy];
    });

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* left filter rail */}
      <div style={{
        width: 220, borderRight: `1px solid ${S.rule}`, padding: '24px 20px',
        flexShrink: 0, overflowY: 'auto',
      }}>
        <div style={{ fontSize: 10.5, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.5, marginBottom: 14 }}>
          FILTERS
        </div>
        <FilterGroup S={S} title="跟踪类型" options={tracks} value={trackFilter} setValue={setTrackFilter} />
        <FilterGroup S={S} title="基金公司" options={companies} value={companyFilter} setValue={setCompanyFilter} />
        <div style={{ marginTop: 26 }}>
          <div style={{ fontSize: 11, fontFamily: S.mono, color: S.ink3, marginBottom: 8, letterSpacing: 0.8 }}>
            费率范围 (1 年)
          </div>
          <div style={{
            height: 4, background: S.bgSunk, borderRadius: 2, position: 'relative', marginTop: 8,
          }}>
            <div style={{
              position: 'absolute', left: '15%', right: '28%', top: 0, bottom: 0,
              background: S.accent, borderRadius: 2,
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontFamily: S.mono, fontSize: 10.5, color: S.ink2 }}>
            <span>0.30%</span><span>3.50%</span>
          </div>
        </div>
      </div>

      {/* main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: '24px 28px 16px' }}>
          <div style={{ fontSize: 11, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.5, marginBottom: 6 }}>
            FUND LIST
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <div>
              <div style={{
                fontSize: 28, fontWeight: 600, letterSpacing: -0.5,
                color: S.ink, fontFamily: S.serif, marginBottom: 4,
              }}>
                基金列表
              </div>
              <div style={{ fontSize: 13, color: S.ink2 }}>
                当前 <span style={{ color: S.ink, fontFamily: S.mono, fontWeight: 600 }}>{rows.length}</span> 只 ·
                共 <span style={{ color: S.ink, fontFamily: S.mono, fontWeight: 600 }}>{window.FUND_DATA.length}</span> 只
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                border: `1px solid ${S.rule}`, borderRadius: 7, padding: '7px 12px',
                background: S.bgRaised, width: 260,
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={S.ink3} strokeWidth="2">
                  <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
                </svg>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索名称 / 代码"
                  style={{
                    flex: 1, border: 'none', outline: 'none', background: 'transparent',
                    color: S.ink, fontSize: 12.5, fontFamily: 'inherit',
                  }} />
              </div>
              <button style={btnSec(S)}>导出 CSV</button>
              <button style={btnPri(S)}>+ 添加</button>
            </div>
          </div>
        </div>

        {/* table */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 28px 28px' }}>
          <div style={{
            background: S.bgRaised, border: `1px solid ${S.rule}`, borderRadius: 10,
            overflow: 'hidden',
          }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
              fontSize: 12.5, color: S.ink,
            }}>
              <thead>
                <tr style={{
                  background: S.bgSunk, borderBottom: `1px solid ${S.rule}`,
                  fontFamily: S.mono, fontSize: 10.5, color: S.ink3, letterSpacing: 1.2,
                }}>
                  {[
                    ['code', '代码', 90, 'left'],
                    ['name', '名称', null, 'left'],
                    ['track', '跟踪', 100, 'left'],
                    ['buy', '申购', 90, 'right'],
                    ['annual', '年费', 80, 'right'],
                    ['day30', '30天', 80, 'right'],
                    ['year1', '1年', 80, 'right'],
                    ['year2', '2年', 80, 'right'],
                    ['', '', 50, 'center'],
                  ].map(([k, l, w, ta]) => (
                    <th key={l} onClick={() => k && setSortBy(k)} style={{
                      padding: '10px 14px', textAlign: ta, fontWeight: 500,
                      width: w || undefined, cursor: k ? 'pointer' : 'default',
                      color: sortBy === k ? S.ink : S.ink3,
                      whiteSpace: 'nowrap',
                    }}>
                      {l}{sortBy === k && <span style={{ marginLeft: 4 }}>↓</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((f, i) => (
                  <tr key={f.code} style={{
                    borderBottom: i < rows.length - 1 ? `1px solid ${S.rule}` : 'none',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = S.bgSunk}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '12px 14px', fontFamily: S.mono, color: S.ink2 }}>
                      {f.code}
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 500, color: S.ink }}>{f.name}</div>
                          <div style={{ fontSize: 10.5, color: S.ink3, marginTop: 1 }}>{f.company}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '12px 14px' }}>
                      <span style={{
                        fontSize: 10.5, fontFamily: S.mono, color: S.ink2,
                        padding: '2px 7px', border: `1px solid ${S.rule}`, borderRadius: 3,
                      }}>
                        {f.track}
                      </span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: S.mono }}>
                      {f.buyFee === 0
                        ? <span style={{ color: S.success }}>免费</span>
                        : <span style={{ color: S.ink }}>{f.buyFee.toFixed(2)}%</span>}
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: S.mono, color: S.ink }}>
                      {f.annual.toFixed(2)}%
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: S.mono, color: S.ink2 }}>
                      {f.day30.toFixed(2)}%
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: S.mono, fontWeight: 600, color: S.accent }}>
                      {f.year1.toFixed(2)}%
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontFamily: S.mono, color: S.ink2 }}>
                      {f.year2.toFixed(2)}%
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center', color: S.ink3 }}>
                      <span style={{ cursor: 'pointer' }}>···</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{
            marginTop: 12, fontSize: 11, fontFamily: S.mono, color: S.ink3,
            display: 'flex', gap: 16,
          }}>
            <span>· 点击列名排序</span>
            <span>· 1年/2年费率按默认折扣计算</span>
            <span>· 悬停查看详细赎回阶梯</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterGroup({ S, title, options, value, setValue }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontFamily: S.mono, color: S.ink3, marginBottom: 8, letterSpacing: 0.8 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {options.map(o => (
          <div key={o} onClick={() => setValue(o)} style={{
            padding: '5px 8px', fontSize: 12, cursor: 'pointer',
            borderRadius: 5, transition: 'all .1s',
            background: value === o ? S.accentBg : 'transparent',
            color: value === o ? S.accent : S.ink2,
            fontWeight: value === o ? 500 : 400,
          }}>
            {o}
          </div>
        ))}
      </div>
    </div>
  );
}

window.PageFundList = PageFundList;
