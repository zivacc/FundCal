# FundCal 科技感数据仪表盘 UI 重设计完整方案

> **项目路径**: `C:\Users\de_us\Desktop\StockBundle\FundCal`
> **设计风格**: 科技感/数据仪表盘（深色背景、发光效果、数据可视化强调）
> **范围**: 整体配色、布局、组件、移动端适配、CSS 结构重构

---

## 目录
1. [CSS 结构重构方案](#一css-结构重构方案)
2. [色彩系统重设计](#二色彩系统重设计)
3. [视觉效果增强](#三视觉效果增强)
4. [布局改进](#四布局改进)
5. [组件样式重设计](#五组件样式重设计)
6. [移动端适配](#六移动端适配)
7. [实施步骤清单](#七实施步骤清单)

---

## 一、CSS 结构重构方案

### 1.1 当前问题分析

| 问题 | 详情 |
|------|------|
| 单文件过大 | `css/style.css` 有 3606 行 |
| 页面样式混杂 | 基金列表、统计页、指数页样式混在一起 |
| 组织混乱 | 没有清晰的模块/组件分离 |
| @media 分散 | 响应式代码散落各处 |
| 命名不一致 | BEM 和非 BEM 混用 |

### 1.2 新目录结构

```
css/
├── main.css                 # 入口文件（@import 汇总）
│
├── base/
│   ├── _variables.css       # CSS 变量（色彩、间距、圆角、阴影）
│   ├── _reset.css           # 基础重置（box-sizing、margin、padding）
│   └── _typography.css      # 字体、文字样式、标题
│
├── components/
│   ├── _buttons.css         # 按钮系统（primary、secondary、sm、lg）
│   ├── _inputs.css          # 输入框、选择框、搜索框
│   ├── _cards.css           # 卡片组件（fund-card、stat-card）
│   ├── _tables.css          # 表格组件（cached-funds-table、fund-detail-table）
│   ├── _modals.css          # 模态框（backdrop、modal、modal-header/body/footer）
│   ├── _dropdowns.css       # 下拉菜单（fund-search-dropdown）
│   ├── _charts.css          # 图表容器（chart-container、chart-wrapper）
│   ├── _toast.css           # Toast 提示
│   └── _fab.css             # 浮动操作按钮
│
├── layout/
│   ├── _header.css          # 页头导航（page-header）
│   ├── _container.css       # 容器布局（container、actions）
│   └── _grid.css            # 网格系统（dashboard-grid）
│
├── pages/
│   ├── _calculator.css      # 主页（费率计算器特有样式）
│   ├── _fund-list.css       # 基金列表页（cached-funds-*）
│   ├── _fund-stats.css      # 统计分析页（fund-stats-*）
│   └── _index-picker.css    # 指数选基页（index-picker-*、index-page-*）
│
└── utilities/
    ├── _animations.css      # 动画定义（fade-in、pulse、shimmer）
    └── _responsive.css      # 响应式断点（统一管理所有 @media）
```

### 1.3 入口文件 `main.css`

```css
/* ══════════════════════════════════════════════════════════════
   FundCal - 基金费率计算器
   入口样式文件
   ══════════════════════════════════════════════════════════════ */

/* Base */
@import 'base/_variables.css';
@import 'base/_reset.css';
@import 'base/_typography.css';

/* Layout */
@import 'layout/_header.css';
@import 'layout/_container.css';
@import 'layout/_grid.css';

/* Components */
@import 'components/_buttons.css';
@import 'components/_inputs.css';
@import 'components/_cards.css';
@import 'components/_tables.css';
@import 'components/_modals.css';
@import 'components/_dropdowns.css';
@import 'components/_charts.css';
@import 'components/_toast.css';
@import 'components/_fab.css';

/* Pages */
@import 'pages/_calculator.css';
@import 'pages/_fund-list.css';
@import 'pages/_fund-stats.css';
@import 'pages/_index-picker.css';

/* Utilities */
@import 'utilities/_animations.css';
@import 'utilities/_responsive.css';
```

### 1.4 HTML 更新

将所有 HTML 文件中的：
```html
<link rel="stylesheet" href="css/style.css">
```
改为：
```html
<link rel="stylesheet" href="css/main.css">
```

---

## 二、色彩系统重设计

### 2.1 新的 CSS 变量 (`base/_variables.css`)

```css
/* ══════════════════════════════════════════════════════════════
   CSS 变量 - 科技感深色仪表盘主题
   ══════════════════════════════════════════════════════════════ */

:root {
  /* ── 背景色梯度 ── */
  --bg-base: #050a12;           /* 最深背景，接近纯黑带微蓝 */
  --bg-raised: #0a1628;         /* 略浅背景，卡片基底 */
  --bg-surface: #0f1f35;        /* 面板/卡片主体背景 */
  --bg-input: #060d18;          /* 输入框背景 */
  --bg-elevated: #0c1a2e;       /* 悬浮面板 */
  --bg-subtle: #071018;         /* 次级背景 */
  --bg-hover: #132744;          /* 悬停状态背景 */
  --bg-muted: #0a1524;          /* 弱化背景 */
  --bg-glass: rgba(10, 22, 40, 0.85); /* 玻璃拟态背景 */

  /* ── 边框系统 ── */
  --border: rgba(56, 189, 248, 0.15);       /* 默认边框：青色透明 */
  --border-hover: rgba(56, 189, 248, 0.35); /* 悬停边框 */
  --border-focus: #38bdf8;                   /* 聚焦边框：亮青色 */
  --border-subtle: rgba(30, 64, 175, 0.2);  /* 弱化边框 */
  --border-glow: rgba(56, 189, 248, 0.5);   /* 发光边框 */

  /* ── 文字色阶 ── */
  --text-primary: #f0f6ff;      /* 主文字：带蓝调的白 */
  --text-secondary: #94b8db;    /* 次文字：淡蓝灰 */
  --text-tertiary: #5b7a9d;     /* 三级文字：暗蓝灰 */
  --text-muted: #3d5a80;        /* 禁用/弱化文字 */
  --text-inverse: #050a12;      /* 反色文字 */

  /* ── 主色调：科技青蓝 ── */
  --accent: #38bdf8;            /* 主强调色：天青 */
  --accent-hover: #60cdff;      /* 悬停态 */
  --accent-active: #0ea5e9;     /* 激活态 */
  --accent-subtle: rgba(56, 189, 248, 0.12);
  --accent-glow: rgba(56, 189, 248, 0.4);
  --accent-neon: 0 0 20px rgba(56, 189, 248, 0.6), 0 0 40px rgba(56, 189, 248, 0.3);

  /* ── 辅助色：电紫 ── */
  --purple: #a78bfa;
  --purple-glow: rgba(167, 139, 250, 0.4);
  --purple-subtle: rgba(167, 139, 250, 0.12);

  /* ── 辅助色：霓虹粉 ── */
  --pink: #f472b6;
  --pink-glow: rgba(244, 114, 182, 0.4);
  --pink-subtle: rgba(244, 114, 182, 0.12);

  /* ── 数据状态颜色 ── */
  --success: #22d3a0;           /* 成功/上涨：翡翠绿 */
  --success-glow: rgba(34, 211, 160, 0.4);
  --success-subtle: rgba(34, 211, 160, 0.12);

  --warning: #fbbf24;           /* 警告/持平：琥珀黄 */
  --warning-glow: rgba(251, 191, 36, 0.4);
  --warning-subtle: rgba(251, 191, 36, 0.12);

  --danger: #ef4444;            /* 危险/下跌：鲜红 */
  --danger-glow: rgba(239, 68, 68, 0.4);
  --danger-subtle: rgba(239, 68, 68, 0.12);

  /* 兼容别名 */
  --green: var(--success);
  --yellow: var(--warning);
  --red: var(--danger);
  --green-subtle: var(--success-subtle);
  --yellow-subtle: var(--warning-subtle);
  --red-subtle: var(--danger-subtle);

  /* ── 渐变定义 ── */
  --gradient-primary: linear-gradient(135deg, #38bdf8 0%, #a78bfa 100%);
  --gradient-surface: linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, transparent 60%);
  --gradient-card: linear-gradient(145deg, rgba(56, 189, 248, 0.06) 0%, transparent 50%);
  --gradient-glow: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.15) 0%, transparent 60%);
  --gradient-border: linear-gradient(135deg, rgba(56, 189, 248, 0.4), rgba(167, 139, 250, 0.4));

  /* ── 圆角 ── */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  /* ── 阴影 ── */
  --shadow-sm: 0 2px 8px rgba(0, 0, 0, 0.4);
  --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 40px rgba(56, 189, 248, 0.05);
  --shadow-lg: 0 8px 40px rgba(0, 0, 0, 0.6), 0 0 60px rgba(56, 189, 248, 0.08);
  --shadow-glow: 0 0 20px rgba(56, 189, 248, 0.3), 0 0 40px rgba(56, 189, 248, 0.1);
  --shadow-glow-strong: 0 0 30px rgba(56, 189, 248, 0.5), 0 0 60px rgba(56, 189, 248, 0.2);

  /* ── 字体 ── */
  --font-body: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

  /* ── 过渡 ── */
  --transition-fast: 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-normal: 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  --transition-glow: 0.3s ease-out;

  /* ── 玻璃拟态参数 ── */
  --glass-blur: blur(16px);
  --glass-saturate: saturate(180%);
}
```

### 2.2 基础重置 (`base/_reset.css`)

```css
/* ══════════════════════════════════════════════════════════════
   基础重置
   ══════════════════════════════════════════════════════════════ */

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

::selection {
  background: var(--accent-glow);
  color: var(--text-primary);
}

html {
  scroll-behavior: smooth;
}

body {
  font-family: var(--font-body);
  background: var(--bg-base);
  color: var(--text-primary);
  min-height: 100vh;
  line-height: 1.6;
  font-size: 14px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  font-family: inherit;
  cursor: pointer;
}

img {
  max-width: 100%;
  height: auto;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-track {
  background: var(--bg-base);
}

::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 5px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-hover);
}
```

### 2.3 字体排版 (`base/_typography.css`)

```css
/* ══════════════════════════════════════════════════════════════
   字体排版
   ══════════════════════════════════════════════════════════════ */

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.3;
  color: var(--text-primary);
}

h1 {
  font-size: 1.65rem;
  letter-spacing: -0.02em;
}

h2 {
  font-size: 1.25rem;
}

h3 {
  font-size: 1rem;
}

/* 渐变标题 */
.gradient-title {
  background: linear-gradient(135deg, var(--text-primary) 40%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* 霓虹标题 */
.neon-title {
  color: var(--accent);
  text-shadow:
    0 0 10px var(--accent-glow),
    0 0 20px rgba(56, 189, 248, 0.3),
    0 0 40px rgba(56, 189, 248, 0.2);
}

/* 副标题 */
.subtitle {
  color: var(--text-secondary);
  font-size: 0.85rem;
  font-weight: 400;
  line-height: 1.5;
}

/* 等宽字体 */
.mono {
  font-family: var(--font-mono);
}
```

---

## 三、视觉效果增强

### 3.1 发光边框效果 (`utilities/_animations.css` 部分)

```css
/* 卡片发光边框基础类 */
.glow-border {
  position: relative;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  overflow: hidden;
}

.glow-border::before {
  content: '';
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1px;
  background: var(--gradient-border);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0;
  transition: opacity var(--transition-glow);
}

.glow-border:hover::before {
  opacity: 1;
}

/* 常亮发光版本 */
.glow-border-active::before {
  opacity: 0.6;
}

.glow-border-active:hover::before {
  opacity: 1;
}
```

### 3.2 玻璃拟态效果

```css
/* 玻璃拟态面板 */
.glass-panel {
  background: var(--bg-glass);
  backdrop-filter: var(--glass-blur) var(--glass-saturate);
  -webkit-backdrop-filter: var(--glass-blur) var(--glass-saturate);
  border: 1px solid rgba(56, 189, 248, 0.15);
  border-radius: var(--radius-lg);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    var(--shadow-md);
}

.glass-panel:hover {
  background: rgba(10, 22, 40, 0.9);
  border-color: rgba(56, 189, 248, 0.3);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    var(--shadow-lg),
    var(--shadow-glow);
}
```

### 3.3 动画定义 (`utilities/_animations.css`)

```css
/* ══════════════════════════════════════════════════════════════
   动画定义
   ══════════════════════════════════════════════════════════════ */

/* 数据脉冲效果 */
@keyframes data-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 var(--accent-glow);
  }
  50% {
    box-shadow: 0 0 0 8px transparent;
  }
}

.data-pulse {
  animation: data-pulse 2s ease-in-out infinite;
}

/* 淡入效果 */
@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.fade-in {
  animation: fade-in 0.25s ease-out forwards;
}

/* 加载波纹效果 */
@keyframes loading-wave {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

.loading-shimmer {
  position: relative;
  overflow: hidden;
}

.loading-shimmer::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent,
    rgba(56, 189, 248, 0.15),
    transparent
  );
  animation: loading-wave 1.5s infinite;
}

/* 进度条增长动画 */
@keyframes bar-grow {
  from {
    width: 0%;
  }
}

/* 按钮涟漪效果 */
@keyframes ripple {
  to {
    transform: scale(2);
    opacity: 0;
  }
}
```

---

## 四、布局改进

### 4.1 页头导航 (`layout/_header.css`)

```css
/* ══════════════════════════════════════════════════════════════
   页头导航
   ══════════════════════════════════════════════════════════════ */

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 0.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid var(--border);
}

.page-header h1 {
  font-size: 1.65rem;
  font-weight: 700;
  margin-bottom: 0.4rem;
  background: linear-gradient(135deg, var(--text-primary) 40%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.page-header-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
}

.page-header-link {
  font-size: 1rem;
  font-weight: 600;
  background: linear-gradient(135deg, var(--text-primary) 40%, var(--accent) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  text-decoration: none;
  transition: opacity var(--transition-fast);
}

.page-header-link:hover {
  opacity: 0.8;
  text-decoration: underline;
}

/* 固定导航栏版本（可选） */
.nav-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  height: 56px;
  background: var(--bg-glass);
  backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.nav-links {
  display: flex;
  gap: 0.25rem;
}

.nav-link {
  padding: 0.5rem 1rem;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  transition: all var(--transition-fast);
  position: relative;
}

.nav-link:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.nav-link.active {
  color: var(--accent);
  background: var(--accent-subtle);
}

.nav-link.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background: var(--accent);
  border-radius: 2px;
  box-shadow: 0 0 8px var(--accent-glow);
}
```

### 4.2 容器布局 (`layout/_container.css`)

```css
/* ══════════════════════════════════════════════════════════════
   容器布局
   ══════════════════════════════════════════════════════════════ */

.container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 2rem 2rem 3rem;
}

/* 如果使用固定导航栏 */
.container.with-nav {
  padding-top: calc(56px + 2rem);
}

.actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.75rem;
  flex-wrap: wrap;
  align-items: center;
}

.actions-above-cards {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1rem;
  margin-top: 1.25rem;
}

.actions-above-cards-center {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.actions-above-cards-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-left: auto;
}
```

### 4.3 网格系统 (`layout/_grid.css`)

```css
/* ══════════════════════════════════════════════════════════════
   网格系统
   ══════════════════════════════════════════════════════════════ */

.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1rem;
}

.card-full { grid-column: span 12; }
.card-half { grid-column: span 6; }
.card-third { grid-column: span 4; }
.card-quarter { grid-column: span 3; }
.card-two-thirds { grid-column: span 8; }

@media (max-width: 1200px) {
  .card-quarter { grid-column: span 6; }
  .card-third { grid-column: span 6; }
}

@media (max-width: 768px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
    gap: 0.75rem;
  }

  .card-full,
  .card-half,
  .card-third,
  .card-quarter,
  .card-two-thirds {
    grid-column: span 1;
  }
}
```

---

## 五、组件样式重设计

### 5.1 按钮系统 (`components/_buttons.css`)

```css
/* ══════════════════════════════════════════════════════════════
   按钮系统
   ══════════════════════════════════════════════════════════════ */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  background: var(--bg-surface);
  color: var(--text-primary);
  transition: all var(--transition-fast);
  position: relative;
  overflow: hidden;
  user-select: none;
  white-space: nowrap;
}

/* 涟漪效果 */
.btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, rgba(255,255,255,0.15) 0%, transparent 70%);
  opacity: 0;
  transform: scale(0);
  transition: transform 0.4s ease, opacity 0.4s ease;
}

.btn:active::before {
  opacity: 1;
  transform: scale(2);
  transition: transform 0s, opacity 0s;
}

/* 主要按钮 - 发光渐变 */
.btn-primary {
  background: var(--gradient-primary);
  border: none;
  color: #fff;
  font-weight: 600;
  box-shadow: 0 4px 15px rgba(56, 189, 248, 0.35);
}

.btn-primary:hover {
  box-shadow: var(--shadow-glow-strong);
  transform: translateY(-1px);
}

.btn-primary:active {
  transform: translateY(0);
  box-shadow: 0 2px 10px rgba(56, 189, 248, 0.3);
}

/* 次要按钮 - 轮廓风格 */
.btn-secondary {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.btn-secondary:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-subtle);
  box-shadow: 0 0 15px rgba(56, 189, 248, 0.15);
}

/* 危险按钮 */
.btn-danger {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-secondary);
}

.btn-danger:hover {
  border-color: var(--danger);
  color: var(--danger);
  background: var(--danger-subtle);
  box-shadow: 0 0 15px var(--danger-glow);
}

/* 成功按钮 */
.btn-success {
  background: var(--success);
  border-color: var(--success);
  color: var(--text-inverse);
}

.btn-success:hover {
  background: #1fbc8f;
  box-shadow: 0 0 20px var(--success-glow);
}

/* 幽灵按钮 */
.btn-ghost {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  padding: 0.5rem 0.75rem;
}

.btn-ghost:hover {
  color: var(--accent);
  background: var(--accent-subtle);
}

/* 尺寸变体 */
.btn-sm {
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  border-radius: var(--radius-sm);
}

.btn-lg {
  padding: 0.875rem 1.75rem;
  font-size: 1rem;
  border-radius: var(--radius-lg);
}

/* 图标按钮 */
.btn-icon {
  padding: 0.625rem;
  aspect-ratio: 1;
}

.btn-icon.btn-sm {
  padding: 0.5rem;
}

/* 禁用状态 */
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}
```

### 5.2 输入框系统 (`components/_inputs.css`)

```css
/* ══════════════════════════════════════════════════════════════
   输入框系统
   ══════════════════════════════════════════════════════════════ */

.input-group {
  position: relative;
}

.input {
  width: 100%;
  padding: 0.625rem 0.875rem;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.875rem;
  transition: all var(--transition-fast);
}

.input::placeholder {
  color: var(--text-muted);
}

.input:hover {
  border-color: var(--border-hover);
}

.input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow:
    0 0 0 3px var(--accent-subtle),
    0 0 20px rgba(56, 189, 248, 0.1);
  background: linear-gradient(
    180deg,
    rgba(56, 189, 248, 0.05) 0%,
    var(--bg-input) 100%
  );
}

/* 带图标的输入框 */
.input-with-icon {
  padding-left: 2.5rem;
}

.input-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  pointer-events: none;
  transition: color var(--transition-fast);
}

.input:focus ~ .input-icon {
  color: var(--accent);
}

/* 搜索输入框 */
.search-input {
  background: linear-gradient(
    180deg,
    var(--bg-input) 0%,
    rgba(6, 13, 24, 0.8) 100%
  );
  border: 1px solid rgba(56, 189, 248, 0.1);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
}

.search-input:focus {
  border-color: var(--accent);
  box-shadow:
    inset 0 1px 3px rgba(0, 0, 0, 0.1),
    0 0 0 3px var(--accent-subtle),
    0 0 30px rgba(56, 189, 248, 0.15);
}

/* 下拉选择框 */
.select {
  appearance: none;
  padding: 0.625rem 2.5rem 0.625rem 0.875rem;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-family: var(--font-body);
  font-size: 0.875rem;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%235b7a9d' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  transition: all var(--transition-fast);
}

.select:hover {
  border-color: var(--border-hover);
}

.select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2338bdf8' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
}

/* 数字输入框 */
input[type="number"] {
  font-family: var(--font-mono);
}
```

### 5.3 卡片系统 (`components/_cards.css`)

```css
/* ══════════════════════════════════════════════════════════════
   卡片系统
   ══════════════════════════════════════════════════════════════ */

.card {
  position: relative;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  transition: all var(--transition-normal);
  overflow: hidden;
}

/* 顶部渐变装饰 */
.card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 100px;
  background: var(--gradient-glow);
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-normal);
}

.card:hover {
  border-color: var(--border-hover);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.card:hover::before {
  opacity: 1;
}

/* 卡片头部 */
.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.card-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* 状态指示器 */
.card-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 10px var(--accent-glow);
  animation: data-pulse 2s ease-in-out infinite;
}

/* 基金卡片 */
.fund-card {
  flex: 0 0 auto;
  width: 360px;
  background: linear-gradient(
    145deg,
    rgba(15, 31, 53, 0.9) 0%,
    var(--bg-surface) 100%
  );
}

.fund-card::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: var(--card-accent-color, var(--accent));
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.fund-card:hover::after {
  opacity: 1;
}

/* 统计卡片 */
.stat-card {
  text-align: center;
  padding: 1.5rem 1rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  background: var(--gradient-primary);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  margin-bottom: 0.25rem;
}

.stat-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.stat-change {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.5rem;
  font-size: 0.8125rem;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
}

.stat-change.positive {
  color: var(--success);
  background: var(--success-subtle);
}

.stat-change.negative {
  color: var(--danger);
  background: var(--danger-subtle);
}
```

### 5.4 表格系统 (`components/_tables.css`)

```css
/* ══════════════════════════════════════════════════════════════
   表格系统
   ══════════════════════════════════════════════════════════════ */

.table-container {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
  overflow: hidden;
}

.table {
  width: 100%;
  border-collapse: collapse;
}

.table thead {
  background: linear-gradient(
    180deg,
    rgba(56, 189, 248, 0.08) 0%,
    var(--bg-muted) 100%
  );
}

.table th {
  padding: 0.875rem 1rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  text-align: left;
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bg-muted);
}

.table td {
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-subtle);
}

.table tbody tr {
  transition: background var(--transition-fast);
}

.table tbody tr:hover {
  background: var(--bg-hover);
}

/* 选中行 */
.table tbody tr.selected {
  background: var(--accent-subtle);
  box-shadow: inset 3px 0 0 var(--accent);
}

/* 交替行 */
.table-striped tbody tr:nth-child(even) {
  background: rgba(6, 16, 24, 0.4);
}

/* 排序指示器 */
.table th.sortable {
  cursor: pointer;
  user-select: none;
}

.table th.sortable:hover {
  color: var(--accent);
}

.table th.sorted {
  color: var(--accent);
}

.table th.sorted::after {
  content: ' ▲';
  font-size: 0.625rem;
}

.table th.sorted.desc::after {
  content: ' ▼';
}

/* 等宽数字列 */
.table-cell-mono {
  font-family: var(--font-mono);
  font-size: 0.8125rem;
}

/* 状态颜色 */
.table-cell-positive {
  color: var(--success);
}

.table-cell-negative {
  color: var(--danger);
}
```

### 5.5 模态框 (`components/_modals.css`)

```css
/* ══════════════════════════════════════════════════════════════
   模态框
   ══════════════════════════════════════════════════════════════ */

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 10, 18, 0.8);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 1000;
  opacity: 0;
  visibility: hidden;
  transition: all var(--transition-normal);
}

.modal-backdrop[aria-hidden="false"],
.modal-backdrop.open {
  opacity: 1;
  visibility: visible;
}

.modal {
  width: min(640px, 100%);
  max-height: calc(100vh - 2rem);
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(0.95) translateY(10px);
  transition: transform var(--transition-normal);
}

.modal-backdrop[aria-hidden="false"] .modal,
.modal-backdrop.open .modal {
  transform: scale(1) translateY(0);
}

/* 顶部发光线 */
.modal::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: var(--gradient-border);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: linear-gradient(
    180deg,
    rgba(56, 189, 248, 0.05) 0%,
    transparent 100%
  );
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-close-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  transition: all var(--transition-fast);
}

.modal-close-btn:hover {
  background: var(--danger-subtle);
  color: var(--danger);
}

.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
  background: var(--bg-muted);
}
```

### 5.6 图表容器 (`components/_charts.css`)

```css
/* ══════════════════════════════════════════════════════════════
   图表容器
   ══════════════════════════════════════════════════════════════ */

.chart-container {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 1.25rem;
  margin-bottom: 1rem;
  position: relative;
  min-height: 500px;
  height: calc(100vh - 14rem);
  box-shadow: var(--shadow-md);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 装饰性背景 */
.chart-container::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 80%, rgba(56, 189, 248, 0.08) 0%, transparent 40%),
    radial-gradient(circle at 80% 20%, rgba(167, 139, 250, 0.06) 0%, transparent 40%);
  pointer-events: none;
}

/* 网格背景（可选） */
.chart-grid-bg {
  background-image:
    linear-gradient(rgba(56, 189, 248, 0.03) 1px, transparent 1px),
    linear-gradient(90deg, rgba(56, 189, 248, 0.03) 1px, transparent 1px);
  background-size: 40px 40px;
}

.chart-main {
  display: flex;
  align-items: stretch;
  gap: 0.75rem;
  flex: 1 1 auto;
  min-height: 0;
}

.chart-wrapper {
  position: relative;
  flex: 1 1 auto;
  min-height: 310px;
}

/* 图表工具栏 */
.chart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

/* 图表图例 */
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-muted);
  border-radius: var(--radius-md);
  margin-top: 1rem;
}

.chart-legend-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.chart-legend-item:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.chart-legend-color {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  box-shadow: 0 0 8px currentColor;
}

.chart-legend-item.disabled {
  opacity: 0.4;
}

.chart-legend-item.disabled .chart-legend-color {
  box-shadow: none;
}
```

---

## 六、移动端适配

### 6.1 响应式断点 (`utilities/_responsive.css`)

```css
/* ══════════════════════════════════════════════════════════════
   响应式断点
   ══════════════════════════════════════════════════════════════ */

/*
  断点定义:
  - xs: < 480px   (小手机)
  - sm: 480-640px (手机)
  - md: 640-768px (大手机/平板竖屏)
  - lg: 768-1024px (平板横屏/小笔记本)
  - xl: 1024-1280px (笔记本)
  - 2xl: > 1280px (桌面)
*/

/* ── 中等屏幕及以下 ── */
@media (max-width: 1024px) {
  :root {
    --radius-lg: 12px;
    --radius-xl: 18px;
  }

  .container {
    padding: 1rem;
  }
}

/* ── 平板及以下 ── */
@media (max-width: 768px) {
  :root {
    --radius-lg: 10px;
    --radius-xl: 14px;
  }

  .page-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .page-header-right {
    flex-direction: row;
    gap: 0.75rem;
  }

  /* 导航响应式 */
  .nav-links {
    display: none;
  }

  .nav-mobile-menu-btn {
    display: flex;
  }

  /* 表格横向滚动 */
  .table-container {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .table {
    min-width: 600px;
  }

  /* 图表高度调整 */
  .chart-container {
    height: auto;
    min-height: 400px;
  }

  .chart-main {
    flex-direction: column;
  }

  .chart-main-right {
    flex: 0 0 auto;
    max-width: none;
    border-left: none;
    border-top: 1px solid var(--border-subtle);
    padding-top: 0.75rem;
  }
}

/* ── 手机 ── */
@media (max-width: 640px) {
  body {
    font-size: 14px;
  }

  h1 {
    font-size: 1.25rem;
  }

  .container {
    padding: 0.75rem;
  }

  /* 基金卡片全宽 */
  .fund-cards {
    flex-direction: column;
    align-items: stretch;
    width: auto;
  }

  .fund-card {
    width: 100%;
  }

  /* 图表容器 */
  .chart-container {
    padding: 0.875rem;
    min-height: 350px;
  }

  .chart-wrapper {
    min-height: 250px;
  }

  /* 模态框全屏 */
  .modal {
    width: 100%;
    max-height: 100vh;
    border-radius: 0;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding: 0.875rem;
  }

  /* 按钮增大 */
  .btn {
    min-height: 44px;
    min-width: 44px;
  }

  .btn-sm {
    min-height: 36px;
    padding: 0.5rem 0.875rem;
  }

  /* 输入框增大（防止 iOS 缩放） */
  .input,
  .select {
    min-height: 44px;
    font-size: 16px;
  }
}

/* ── 触摸设备优化 ── */
@media (hover: none) {
  .btn:hover {
    transform: none;
    box-shadow: none;
  }

  .card:hover {
    transform: none;
  }

  .table tbody tr:hover {
    background: transparent;
  }
}

/* ── 安全区域适配 (iPhone X+) ── */
@supports (padding: max(0px)) {
  .container {
    padding-left: max(0.75rem, env(safe-area-inset-left));
    padding-right: max(0.75rem, env(safe-area-inset-right));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }

  .modal-footer {
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
  }

  /* 底部浮动按钮 */
  .fab {
    bottom: max(1rem, calc(env(safe-area-inset-bottom) + 0.5rem));
    right: max(1rem, env(safe-area-inset-right));
  }
}
```

### 6.2 移动端导航

```css
/* 汉堡菜单按钮 */
.nav-mobile-menu-btn {
  display: none;
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
}

.nav-mobile-menu-btn span {
  display: block;
  width: 22px;
  height: 2px;
  background: currentColor;
  transition: all var(--transition-fast);
  border-radius: 1px;
}

.nav-mobile-menu-btn.open span:nth-child(1) {
  transform: rotate(45deg) translate(5px, 5px);
}

.nav-mobile-menu-btn.open span:nth-child(2) {
  opacity: 0;
}

.nav-mobile-menu-btn.open span:nth-child(3) {
  transform: rotate(-45deg) translate(5px, -5px);
}

/* 移动端抽屉菜单 */
.mobile-drawer {
  position: fixed;
  top: 56px;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-surface);
  transform: translateX(-100%);
  transition: transform var(--transition-normal);
  z-index: 90;
  overflow-y: auto;
}

.mobile-drawer.open {
  transform: translateX(0);
}

.mobile-drawer-nav {
  display: flex;
  flex-direction: column;
  padding: 1rem;
}

.mobile-drawer-link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem;
  color: var(--text-secondary);
  text-decoration: none;
  font-size: 1rem;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}

.mobile-drawer-link:hover,
.mobile-drawer-link.active {
  background: var(--accent-subtle);
  color: var(--accent);
}
```

---

## 七、实施步骤清单

### 阶段 1: CSS 结构重构 ⭐ 优先级最高

- [ ] 创建 `css/` 新目录结构
- [ ] 创建 `css/main.css` 入口文件
- [ ] 创建 `css/base/_variables.css` - 复制 `:root` 变量
- [ ] 创建 `css/base/_reset.css` - 复制基础重置样式
- [ ] 创建 `css/base/_typography.css` - 复制字体样式
- [ ] 创建 `css/layout/_header.css` - 提取 `.page-header` 相关
- [ ] 创建 `css/layout/_container.css` - 提取 `.container`, `.actions` 相关
- [ ] 创建 `css/components/_buttons.css` - 提取 `.btn` 相关
- [ ] 创建 `css/components/_inputs.css` - 提取输入框相关
- [ ] 创建 `css/components/_cards.css` - 提取 `.fund-card` 相关
- [ ] 创建 `css/components/_tables.css` - 提取表格相关
- [ ] 创建 `css/components/_modals.css` - 提取 `.modal` 相关
- [ ] 创建 `css/components/_dropdowns.css` - 提取下拉菜单
- [ ] 创建 `css/components/_charts.css` - 提取 `.chart-*` 相关
- [ ] 创建 `css/pages/_calculator.css` - 主页特有样式
- [ ] 创建 `css/pages/_fund-list.css` - `.cached-funds-*` 样式
- [ ] 创建 `css/pages/_fund-stats.css` - `.fund-stats-*` 样式
- [ ] 创建 `css/pages/_index-picker.css` - `.index-picker-*`, `.index-page-*` 样式
- [ ] 创建 `css/utilities/_animations.css` - 动画 `@keyframes`
- [ ] 创建 `css/utilities/_responsive.css` - 所有 `@media` 查询
- [ ] 更新所有 HTML 文件的 CSS 引用
- [ ] 测试所有页面正常显示

### 阶段 2: 色彩系统更新

- [ ] 更新 `_variables.css` 为新色彩系统
- [ ] 检查所有页面颜色显示
- [ ] 确保对比度符合 WCAG AA 标准

### 阶段 3: 组件样式更新

- [ ] 更新按钮样式（渐变、发光）
- [ ] 更新输入框样式（聚焦效果）
- [ ] 更新卡片样式（边框发光）
- [ ] 更新表格样式（行样式）
- [ ] 更新模态框样式（玻璃拟态）

### 阶段 4: 布局优化

- [ ] 实现固定导航栏（可选）
- [ ] 调整页面间距
- [ ] 测试响应式断点

### 阶段 5: 图表优化

- [ ] 更新 Chart.js 主题配置（`js/app.js`）
- [ ] 添加图表容器装饰效果

### 阶段 6: 移动端适配

- [ ] 优化触摸交互
- [ ] 实现移动导航
- [ ] 真机测试 iOS/Android

### 阶段 7: 动画打磨

- [ ] 添加微交互动画
- [ ] 优化加载状态
- [ ] 检查动画性能

---

## 附录：关键文件路径

| 文件 | 路径 |
|------|------|
| 现有 CSS | `C:\Users\de_us\Desktop\StockBundle\FundCal\css\style.css` |
| 主页 | `C:\Users\de_us\Desktop\StockBundle\FundCal\index.html` |
| 基金列表 | `C:\Users\de_us\Desktop\StockBundle\FundCal\cached-funds.html` |
| 统计页 | `C:\Users\de_us\Desktop\StockBundle\FundCal\cached-fund-stats.html` |
| 指数选基 | `C:\Users\de_us\Desktop\StockBundle\FundCal\index-picker.html` |
| 主 JS | `C:\Users\de_us\Desktop\StockBundle\FundCal\js\app.js` |

---

> **提示**: 在新的 agent 会话中，可以直接说 "请按照 `UI-REDESIGN-PLAN.md` 开始实施 CSS 重构" 来继续工作。
