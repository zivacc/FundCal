// Page: 统计 (Stats) — portfolio-wide analytics.
// Big numbers + breakdown tables + cost trend chart. Quiet Light, reads like a financial report.

function PageStats({ S }) {
  const [range, setRange] = useState('1Y');
  const funds = window.FUND_DATA;
  // demo portfolio: weight each fund
  const weights = { '004400': 0.30, '004401': 0.15, '110011': 0.25, '023910': 0.20, '000961': 0.10 };
  const totalInvested = 150000;

  const weightedAnnual = funds.reduce((acc, f) => {
    const w = weights[f.code] || 0;
    return acc + w * (f.mgmtFee + f.custodyFee + f.serviceFee);
  }, 0);
  const estYearCost = totalInvested * weightedAnnual / 100;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '28px 32px' }}>
      {/* header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{
          fontSize: 11, fontFamily: S.mono, color: S.ink3,
          letterSpacing: 1.5, marginBottom: 6,
        }}>
          STATS · PORTFOLIO OVERVIEW
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              fontSize: 28, fontWeight: 600, letterSpacing: -0.5,
              color: S.ink, fontFamily: S.serif, marginBottom: 4,
            }}>
              持仓统计
            </div>
            <div style={{ fontSize: 13.5, color: S.ink2 }}>
              以当前持仓加权计算的历史费用与预估年费
            </div>
          </div>
          <div style={{ display: 'flex', gap: 3, background: S.bgSunk, padding: 3, borderRadius: 7 }}>
            {['30D', '90D', '1Y', 'ALL'].map(r => (
              <button key={r} onClick={() => setRange(r)} style={{
                padding: '5px 12px', fontSize: 11.5, fontFamily: S.mono,
                border: 'none',
                background: range === r ? S.bgRaised : 'transparent',
                color: range === r ? S.ink : S.ink2,
                borderRadius: 5, cursor: 'pointer',
                boxShadow: range === r ? `0 1px 2px rgba(0,0,0,.04)` : 'none',
                fontWeight: range === r ? 600 : 400,
              }}>{r}</button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <Kpi S={S} label="持仓总额" value={<>¥ <Ticker value={totalInvested} dp={0} suffix="" /></>} sub="+ ¥3,240 本月" tone={S.success} />
        <Kpi S={S} label="加权年费" value={<><Ticker value={weightedAnnual} dp={3} /></>} sub="低于行业 0.58%" tone={S.accent} />
        <Kpi S={S} label="本年预估费用" value={<>¥ <Ticker value={estYearCost} dp={0} suffix="" /></>} sub={`按 ${(weightedAnnual).toFixed(2)}% 年化`} tone={S.warm} />
        <Kpi S={S} label="累计已付费用" value={<>¥ <Ticker value={estYearCost * 2.3} dp={0} suffix="" /></>} sub="自 2023 · 8 季度" tone={S.ink2} />
      </div>

      {/* main grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 12 }}>
        {/* trend chart card */}
        <div style={{
          background: S.bgRaised, border: `1px solid ${S.rule}`,
          borderRadius: 10, padding: '16px 18px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{
              fontSize: 11, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.2,
            }}>
              月度费用累计 ({range})
            </div>
            <div style={{ fontSize: 11, fontFamily: S.mono, color: S.ink3 }}>单位 ¥</div>
          </div>
          <SimpleBarChart S={S} />
        </div>

        {/* allocation */}
        <div style={{
          background: S.bgRaised, border: `1px solid ${S.rule}`,
          borderRadius: 10, padding: '16px 18px',
        }}>
          <div style={{
            fontSize: 11, fontFamily: S.mono, color: S.ink3,
            letterSpacing: 1.2, marginBottom: 14,
          }}>
            持仓分布
          </div>
          <div style={{ display: 'flex', height: 16, borderRadius: 4, overflow: 'hidden', marginBottom: 16 }}>
            {funds.map(f => (
              <div key={f.code} title={f.name} style={{
                background: f.color, width: `${(weights[f.code] || 0) * 100}%`,
              }} />
            ))}
          </div>
          {funds.map(f => {
            const w = weights[f.code] || 0;
            return (
              <div key={f.code} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                borderBottom: `1px solid ${S.rule}`, fontSize: 12,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.color, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, color: S.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.name}
                </div>
                <div style={{ fontFamily: S.mono, color: S.ink2, fontSize: 11 }}>
                  ¥{(totalInvested * w).toLocaleString()}
                </div>
                <div style={{
                  fontFamily: S.mono, fontWeight: 600, color: S.ink,
                  width: 52, textAlign: 'right',
                }}>
                  {(w * 100).toFixed(1)}%
                </div>
              </div>
            );
          })}
        </div>

        {/* cost breakdown */}
        <div style={{
          gridColumn: '1 / -1', background: S.bgRaised,
          border: `1px solid ${S.rule}`, borderRadius: 10, padding: '16px 18px',
        }}>
          <div style={{
            fontSize: 11, fontFamily: S.mono, color: S.ink3,
            letterSpacing: 1.2, marginBottom: 12,
          }}>
            按基金分解 · 费用构成
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: S.ink }}>
            <thead>
              <tr style={{ fontFamily: S.mono, fontSize: 10.5, color: S.ink3, letterSpacing: 1.2 }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', fontWeight: 500 }}>基金</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 500 }}>持仓</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 500 }}>管理费</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 500 }}>托管费</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 500 }}>服务费</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 500 }}>合计年费</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', fontWeight: 500 }}>预估年成本 ¥</th>
              </tr>
            </thead>
            <tbody>
              {funds.map((f, i) => {
                const w = weights[f.code] || 0;
                const hold = totalInvested * w;
                const ann = f.mgmtFee + f.custodyFee + f.serviceFee;
                const cost = hold * ann / 100;
                return (
                  <tr key={f.code} style={{ borderTop: `1px solid ${S.rule}` }}>
                    <td style={{ padding: '10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: f.color }} />
                      <span>{f.name}</span>
                      <span style={{ fontFamily: S.mono, fontSize: 10.5, color: S.ink3, marginLeft: 2 }}>{f.code}</span>
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono, color: S.ink2 }}>
                      ¥{hold.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono }}>{f.mgmtFee.toFixed(2)}%</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono }}>{f.custodyFee.toFixed(2)}%</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono }}>{f.serviceFee.toFixed(2)}%</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono, fontWeight: 600 }}>{ann.toFixed(2)}%</td>
                    <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono, fontWeight: 600, color: S.accent }}>
                      ¥{cost.toFixed(0)}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ borderTop: `2px solid ${S.ruleStrong}`, background: S.bgSunk }}>
                <td style={{ padding: '10px', fontWeight: 600, color: S.ink }}>合计</td>
                <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono, fontWeight: 600 }}>¥{totalInvested.toLocaleString()}</td>
                <td colSpan={3}></td>
                <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono, fontWeight: 700 }}>{weightedAnnual.toFixed(2)}%</td>
                <td style={{ padding: '10px', textAlign: 'right', fontFamily: S.mono, fontWeight: 700, color: S.accent }}>
                  ¥{estYearCost.toFixed(0)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Kpi({ S, label, value, sub, tone }) {
  return (
    <div style={{
      background: S.bgRaised, border: `1px solid ${S.rule}`,
      borderRadius: 10, padding: '14px 16px',
    }}>
      <div style={{
        fontSize: 10.5, fontFamily: S.mono, color: S.ink3,
        letterSpacing: 1.2, marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 26, fontFamily: S.mono, fontWeight: 600,
        color: S.ink, letterSpacing: -0.5,
      }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: tone || S.ink2, marginTop: 6, fontFamily: S.mono }}>
        {sub}
      </div>
    </div>
  );
}

function SimpleBarChart({ S }) {
  // 12 months of mock data
  const months = ['5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月', '4月'];
  const values = [142, 168, 155, 192, 210, 198, 234, 265, 247, 280, 318, 342];
  const max = Math.max(...values);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 200 }}>
      {months.map((m, i) => (
        <div key={m} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ fontSize: 10, fontFamily: S.mono, color: S.ink3 }}>
            {values[i]}
          </div>
          <div style={{
            width: '100%', height: `${(values[i] / max) * 160}px`,
            background: i === values.length - 1 ? S.accent : S.accentBg,
            border: `1px solid ${i === values.length - 1 ? S.accent : S.ruleStrong}`,
            borderRadius: '3px 3px 0 0',
            transition: 'height .6s cubic-bezier(.2,.7,.3,1)',
          }} />
          <div style={{ fontSize: 10, fontFamily: S.mono, color: S.ink3 }}>
            {m}
          </div>
        </div>
      ))}
    </div>
  );
}

window.PageStats = PageStats;
