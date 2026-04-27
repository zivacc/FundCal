/* 主题切换：浅色 / 深色，持久化到 localStorage */
(function () {
  'use strict';

  var STORAGE_KEY = 'fundcal-theme';
  var btn = null;
  var iconEl = null;

  function getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (iconEl) iconEl.textContent = theme === 'dark' ? '☾' : '◐';
    if (btn) btn.setAttribute('aria-label', theme === 'dark' ? '切换到浅色主题' : '切换到深色主题');
    try {
      window.dispatchEvent(new CustomEvent('fundcal-theme-change', { detail: { theme: theme } }));
    } catch (e) {}
  }

  function toggle() {
    var next = getTheme() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    applyTheme(next);
  }

  function init() {
    btn = document.getElementById('theme-toggle');
    if (!btn) return;
    iconEl = btn.querySelector('.theme-toggle-icon');
    applyTheme(getTheme());
    btn.addEventListener('click', toggle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
