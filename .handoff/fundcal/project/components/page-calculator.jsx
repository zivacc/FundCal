// Page: 计算器 (Calculator)
// Main page — fund spec-sheet cards row, chart with fullscreen button, floating fund list tab.

function PageCalculator({ S, state, setState }) {
  const { discount, maxDay, skipPenalty, visibleFunds, tabOpen, fullscreen } = state;
  const set = (k, v) => setState(s => ({ ...s, [k]: v }));

  const funds = window.FUND_DATA;
  const visibleData = funds.filter(f => visibleFunds[f.code]);

  return (
    <div style={{ position: 'relative', flex: 1, overflow: 'auto' }}>
      {/* page header */}
      <div style={{ padding: '28px 32px 20px' }}>
        <div style={{
          fontSize: 11, color: S.ink3, fontFamily: S.mono,
          marginBottom: 6, letterSpacing: 1.5,
        }}>
          CALCULATOR
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{
              fontSize: 28, fontWeight: 600, letterSpacing: -0.5,
              marginBottom: 4, color: S.ink, fontFamily: S.serif,
            }}>
              基金费率计算器
            </div>
            <div style={{ fontSize: 13.5, color: S.ink2, maxWidth: 600 }}>
              对比多只基金在不同持有期限下的累计费率,并自动标注交叉点。
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnSec(S)}>导入</button>
            <button style={btnSec(S)}>导出</button>
            <button style={btnPri(S)}>+ 添加基金</button>
          </div>
        </div>
      </div>

      {/* search bar */}
      <div style={{ padding: '0 32px 16px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          border: `1px solid ${S.rule}`, borderRadius: 8, padding: '10px 14px',
          background: S.bgRaised, maxWidth: 520,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={S.ink3} strokeWidth="2">
            <circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" />
          </svg>
          <span style={{ color: S.ink3, fontSize: 13 }}>基金代码 / 名称 / 拼音首字母…</span>
          <div style={{ flex: 1 }} />
          <span style={{
            fontFamily: S.mono, fontSize: 11, color: S.ink3,
            padding: '2px 6px', border: `1px solid ${S.rule}`, borderRadius: 4,
          }}>⌘K</span>
        </div>
      </div>

      {/* fund cards row — spec sheet style */}
      <div style={{ padding: '0 32px 18px', display: 'flex', gap: 10, overflowX: 'hidden' }}>
        {funds.slice(0, 4).map(f => (
          <SpecSheetCard key={f.code} fund={f} S={S} discount={discount} />
        ))}
        <div style={{
          width: 240, minHeight: 200, border: `1.5px dashed ${S.ruleStrong}`,
          borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexDirection: 'column', gap: 6, color: S.ink3,
        }}>
          <div style={{ fontSize: 20, color: S.ink3 }}>+</div>
          <div style={{ fontSize: 12 }}>添加基金卡片</div>
        </div>
      </div>

      {/* controls row */}
      <div style={{
        padding: '0 32px 12px', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: S.ink2 }}>
          <span>显示天数</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[60, 180, 365, 730].map(d => (
              <button key={d} onClick={() => set('maxDay', d)} style={chipBtn(S, maxDay === d)}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div style={{ width: 1, height: 16, background: S.rule }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.ink2 }}>
          <span>买入折扣</span>
          <select value={discount} onChange={e => set('discount', +e.target.value)} style={{
            padding: '4px 8px', fontSize: 12, fontFamily: S.mono,
            border: `1px solid ${S.rule}`, background: S.bgRaised,
            color: S.ink, borderRadius: 5, cursor: 'pointer',
          }}>
            <option value="1">原价</option>
            <option value="0.1">一折</option>
            <option value="0.01">0.1折</option>
            <option value="0">免申购</option>
          </select>
        </div>
        <div style={{ width: 1, height: 16, background: S.rule }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: S.ink2, cursor: 'pointer' }}>
          <input type="checkbox" checked={skipPenalty}
            onChange={e => set('skipPenalty', e.target.checked)} />
          忽略惩罚期
        </label>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: S.ink3, fontFamily: S.mono }}>
          {visibleData.length} / {funds.length} 基金
        </div>
      </div>

      {/* chart area */}
      <div style={{ padding: '0 32px 28px', position: 'relative' }}>
        <div style={{
          background: S.bgRaised, border: `1px solid ${S.rule}`,
          borderRadius: 10, padding: '14px 20px 10px', position: 'relative',
        }}>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'center', marginBottom: 8,
          }}>
            <div style={{
              fontSize: 11, fontFamily: S.mono, color: S.ink3, letterSpacing: 1.2,
            }}>
              累计费率 × 持有天数
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ fontSize: 11, color: S.ink3, fontFamily: S.mono }}>
                Y 百分比 · X 天数
              </div>
              <button onClick={() => set('fullscreen', true)} title="全屏显示" style={{
                padding: '4px 8px', background: 'transparent',
                border: `1px solid ${S.rule}`, color: S.ink2,
                borderRadius: 5, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 11, fontFamily: S.mono,
              }}
              onMouseEnter={e => { e.currentTarget.style.background = S.bgSunk; e.currentTarget.style.color = S.ink; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = S.ink2; }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>
                </svg>
                全屏
              </button>
            </div>
          </div>
          <FeeChart funds={visibleData} width={1220} height={360} theme={S.chart}
            maxDay={maxDay} discount={discount} />
        </div>

        <FundListPanel
          funds={funds} visible={visibleFunds}
          setVisible={(v) => set('visibleFunds', typeof v === 'function' ? v(visibleFunds) : v)}
          open={tabOpen} setOpen={(v) => set('tabOpen', v)}
          S={S} style={{ right: 44, top: 14 }}
        />
      </div>
    </div>
  );
}

function SpecSheetCard({ fund, S, discount }) {
  const annual = fund.mgmtFee + fund.custodyFee + fund.serviceFee;
  const year1 = window.computeCumCost(fund, 365, discount);
  return (
    <div style={{
      flex: 1, minWidth: 0, background: S.bgRaised, border: `1px solid ${S.rule}`,
      borderRadius: 10, padding: '14px 16px', position: 'relative',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: fund.color }} />
        <div style={{ fontFamily: S.mono, fontSize: 11, color: S.ink3 }}>{fund.code}</div>
        <div style={{ flex: 1 }} />
        <div style={{
          fontSize: 10, color: S.ink3, padding: '1px 6px',
          border: `1px solid ${S.rule}`, borderRadius: 3,
        }}>
          {fund.track}
        </div>
      </div>
      <div style={{
        fontSize: 14, fontWeight: 500, marginBottom: 10, color: S.ink,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{fund.name}</div>

      <table style={{ width: '100%', fontSize: 11.5, fontFamily: S.mono, borderCollapse: 'collapse' }}>
        <tbody>
          <tr style={{ borderTop: `1px solid ${S.rule}` }}>
            <td style={{ padding: '5px 0', color: S.ink3 }}>申购</td>
            <td style={{ padding: '5px 0', textAlign: 'right', color: S.ink }}>
              {fund.buyFee === 0 ? '免费' : `${fund.buyFee.toFixed(2)}% × ${(discount*10).toFixed(1)}折`}
            </td>
          </tr>
          <tr style={{ borderTop: `1px solid ${S.rule}` }}>
            <td style={{ padding: '5px 0', color: S.ink3, verticalAlign: 'top' }}>赎回</td>
            <td style={{ padding: '5px 0', textAlign: 'right', color: S.ink }}>
              {fund.sellTiers.slice(0, 3).map((t, i) => (
                <div key={i} style={{ fontSize: 10.5 }}>
                  {t.days === Infinity ? '永久' : `<${t.days}d`} · {t.rate.toFixed(2)}%
                </div>
              ))}
            </td>
          </tr>
          <tr style={{ borderTop: `1px solid ${S.rule}` }}>
            <td style={{ padding: '5px 0', color: S.ink3 }}>年化运作</td>
            <td style={{ padding: '5px 0', textAlign: 'right', color: S.ink }}>{annual.toFixed(2)}%</td>
          </tr>
          <tr style={{ borderTop: `1px solid ${S.ruleStrong}`, background: S.accentBg }}>
            <td style={{ padding: '6px 6px', color: S.accent, fontWeight: 500 }}>持 1 年</td>
            <td style={{ padding: '6px 6px', textAlign: 'right', color: S.accent, fontWeight: 600 }}>
              <Ticker value={year1} dp={2} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

window.PageCalculator = PageCalculator;
