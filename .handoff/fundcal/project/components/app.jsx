// FundCalApp — the single app, wraps all 4 pages with shared top-rail + dark mode + fullscreen chart.

function FundCalApp({ initialPage = 'calc', initialDark = false }) {
  const [page, setPage] = useState(initialPage);
  const [dark, setDark] = useState(initialDark);
  const S = dark ? window.quietThemes.dark : window.quietThemes.light;

  // Shared calculator state — persists across page switches
  const [calcState, setCalcState] = useState({
    discount: 0.1,
    maxDay: 730,
    skipPenalty: false,
    visibleFunds: Object.fromEntries(window.FUND_DATA.map(f => [f.code, true])),
    tabOpen: true,
    fullscreen: false,
  });
  const setFullscreen = (v) => setCalcState(s => ({ ...s, fullscreen: v }));

  return (
    <div style={{
      width: 1440, height: 900, background: S.bg, color: S.ink,
      fontFamily: S.font, fontSize: 13, lineHeight: 1.5,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <TopRail
        S={S}
        activePage={page} setActivePage={setPage}
        darkMode={dark} setDarkMode={setDark}
      />

      {page === 'calc'  && <PageCalculator S={S} state={calcState} setState={setCalcState} />}
      {page === 'list'  && <PageFundList S={S} />}
      {page === 'index' && <PageIndex S={S} />}
      {page === 'stats' && <PageStats S={S} />}

      {calcState.fullscreen && page === 'calc' && (
        <FullscreenChart
          funds={window.FUND_DATA}
          visible={calcState.visibleFunds}
          maxDay={calcState.maxDay}
          setMaxDay={(v) => setCalcState(s => ({ ...s, maxDay: v }))}
          discount={calcState.discount}
          setDiscount={(v) => setCalcState(s => ({ ...s, discount: v }))}
          S={S}
          onClose={() => setFullscreen(false)}
        />
      )}
    </div>
  );
}

window.FundCalApp = FundCalApp;
