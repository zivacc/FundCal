// Quiet Light — theme tokens for light + dark mode
// Pale warm paper in light, warm-cool graphite in dark

const quietThemes = {
  light: {
    mode: 'light',
    font: `'Inter', -apple-system, BlinkMacSystemFont, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`,
    serif: `'Source Serif 4', 'Source Serif Pro', Georgia, serif`,
    mono: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
    bg: '#fbfaf7',
    bgRaised: '#ffffff',
    bgSunk: '#f5f3ec',
    ink: '#1a1918',
    ink2: '#54514b',
    ink3: '#8a867d',
    rule: '#ebe8e1',
    ruleStrong: '#d9d5cc',
    accent: '#3b5bdb',
    accentBg: 'rgba(59, 91, 219, 0.06)',
    accentStrong: '#2844b3',
    warm: '#b8732d',
    success: '#2a8e6c',
    danger: '#c0412d',
    shadow: '0 4px 20px rgba(20, 18, 10, 0.06)',
    shadowStrong: '0 20px 60px rgba(20, 18, 10, 0.12)',
    chart: {
      grid: '#ebe8e1', axis: '#8a867d', glow: false,
      crossFill: '#fbfaf7', crossStroke: '#1a1918',
      axisFont: '10.5px ui-monospace, monospace'
    },
  },
  dark: {
    mode: 'dark',
    font: `'Inter', -apple-system, BlinkMacSystemFont, system-ui, "PingFang SC", "Microsoft YaHei", sans-serif`,
    serif: `'Source Serif 4', 'Source Serif Pro', Georgia, serif`,
    mono: `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
    bg: '#18170f',
    bgRaised: '#201f16',
    bgSunk: '#141310',
    ink: '#f2efe6',
    ink2: '#a8a398',
    ink3: '#6e6a5f',
    rule: '#2e2c22',
    ruleStrong: '#3d3a2e',
    accent: '#8ea6ff',
    accentBg: 'rgba(142, 166, 255, 0.1)',
    accentStrong: '#a8b8ff',
    warm: '#d69559',
    success: '#5fc29a',
    danger: '#e0735f',
    shadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
    shadowStrong: '0 20px 60px rgba(0, 0, 0, 0.5)',
    chart: {
      grid: '#2e2c22', axis: '#6e6a5f', glow: false,
      crossFill: '#18170f', crossStroke: '#f2efe6',
      axisFont: '10.5px ui-monospace, monospace'
    },
  },
};

window.quietThemes = quietThemes;
