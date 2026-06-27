'use strict';

// ui-toggles.js
// 職責：
//   1. r2ExcludePopover  — 開/關 + position:fixed 定位（無 data-action，main.js 不處理）
//   2. bStatsHelpPanel   — 僅補 position:fixed 定位（main.js stopPropagation 後我們收不到 click）
//                          改用 MutationObserver 監聽 display 變化
//   3. corrInfoToggleBtn — 摺疊展開（無 data-action）
//   4. warningHelpPanel  — 開/關（data-action="toggleWarningHelp" → main.js → window.toggleWarningHelp）
//                          MutationObserver 監聽 display 變化補 position:fixed 定位

function positionFixed(popover, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const vpW  = window.innerWidth;
  const vpH  = window.innerHeight;
  const maxW = parseInt(popover.dataset.maxw || '360', 10);
  const popW = popover.offsetWidth || Math.min(vpW * 0.92, maxW);
  const popH = popover.offsetHeight || 400;

  // 水平：錨點左對齊，超出右邊界時右推，最小留 8px 邊距
  let left = rect.left;
  if (left + popW > vpW - 8) left = vpW - popW - 8;
  if (left < 8) left = 8;

  // 垂直：預設錨點下方；若下方空間不足則改為錨點上方
  let top = rect.bottom + 6;
  if (top + popH > vpH - 8) {
    top = rect.top - popH - 6;
    if (top < 8) top = 8; // 上方也不足時貼頂
  }

  popover.style.setProperty('top',  top  + 'px');
  popover.style.setProperty('left', left + 'px');
}

// ── bStatsHelpPanel：MutationObserver 補定位 ─────────────────────────
// main.js 的 toggleBStatsHelp 在 stopPropagation 後控制 display，
// 我們監聽 style 屬性變化，display 變為非 none 時定位。
(function () {
  let panel = null;
  let btn   = null;

  function init() {
    panel = document.getElementById('bStatsHelpPanel');
    btn   = document.getElementById('bStatsHelpBtn');
    if (!panel || !btn) return;

    new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'style') {
          if (panel.style.display !== 'none') positionFixed(panel, btn);
        }
      }
    }).observe(panel, { attributes: true, attributeFilter: ['style'] });
  }

  document.addEventListener('DOMContentLoaded', init);
})();

// ── warningHelpPanel：MutationObserver 補定位 ──────────────────────
// main.js 的 toggleWarningHelp（data-action）在 stopPropagation 後控制 display；
// window.toggleWarningHelp 由此暴露，main.js actionMap 呼叫。
(function () {
  let panel = null;
  let btn   = null;

  function init() {
    panel = document.getElementById('warningHelpPanel');
    btn   = document.getElementById('warningHelpBtn');
    if (!panel || !btn) return;

    // MutationObserver：display 變為非 none 時重新定位
    new MutationObserver(function (mutations) {
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'style') {
          if (panel.style.getPropertyValue('display') !== 'none') positionFixed(panel, btn);
        }
      }
    }).observe(panel, { attributes: true, attributeFilter: ['style'] });

    // 暴露給 main.js actionMap 呼叫（對稱 window.toggleBStatsHelp）
    window.toggleWarningHelp = function (e) {
      const isOpen = panel.style.getPropertyValue('display') === 'block';
      panel.style.setProperty('display', isOpen ? 'none' : 'block');
      // 開啟時由 MutationObserver 觸發 positionFixed（display 設為 block 後 offsetWidth 才可讀）
    };
  }

  document.addEventListener('DOMContentLoaded', init);
})();

// ── r2ExcludePopover & corrInfoToggleBtn：bubble phase click 委派 ────
// 這兩個按鈕沒有 data-action，main.js 不處理，也不 stopPropagation
document.addEventListener('click', function (e) {

  // R2 排除資料說明：開啟按鈕
  const r2Btn = e.target.closest('#r2ExcludeInfoBtn');
  if (r2Btn) {
    const pop = document.getElementById('r2ExcludePopover');
    if (!pop) return;
    const isOpen = pop.style.getPropertyValue('display') === 'block';
    pop.style.setProperty('display', isOpen ? 'none' : 'block');
    if (!isOpen) positionFixed(pop, r2Btn);
    return;
  }

  // R2 排除資料說明：關閉按鈕（×）
  if (e.target.closest('#r2ExcludeCloseBtn')) {
    const pop2 = document.getElementById('r2ExcludePopover');
    if (pop2) pop2.style.setProperty('display', 'none');
    return;
  }

  // corrInfo 摺疊
  if (e.target.closest('#corrInfoToggleBtn')) {
    const body = document.getElementById('corrInfoBody');
    const icon = document.getElementById('corrInfoIcon');
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.setProperty('display', open ? 'none' : 'block');
    if (icon) icon.textContent = open ? '▶' : '▼';
    return;
  }

  // 點擊外部關閉 r2Popover
  // （bStatsHelpPanel / warningHelpPanel 由 main.js hidePanel data-action 關閉，不重複處理）
  const r2Pop = document.getElementById('r2ExcludePopover');
  if (r2Pop && r2Pop.style.getPropertyValue('display') === 'block') {
    if (!r2Pop.contains(e.target)) r2Pop.style.setProperty('display', 'none');
  }

});

// resize 時重新定位
window.addEventListener('resize', function () {
  const r2Pop = document.getElementById('r2ExcludePopover');
  const r2Btn = document.getElementById('r2ExcludeInfoBtn');
  if (r2Pop && r2Btn && r2Pop.style.getPropertyValue('display') === 'block') positionFixed(r2Pop, r2Btn);

  const bPanel = document.getElementById('bStatsHelpPanel');
  const bBtn   = document.getElementById('bStatsHelpBtn');
  if (bPanel && bBtn && bPanel.style.display !== 'none') positionFixed(bPanel, bBtn);

  const wPanel = document.getElementById('warningHelpPanel');
  const wBtn   = document.getElementById('warningHelpBtn');
  if (wPanel && wBtn && wPanel.style.getPropertyValue('display') === 'block') positionFixed(wPanel, wBtn);

  // rRadarInfoPanel：position:fixed，open class 控制顯示
  const rPanel = document.getElementById('rRadarInfoPanel');
  const rBtn   = document.getElementById('rRadarInfoBtn');
  if (rPanel && rBtn && rPanel.classList.contains('open')) {
    if (typeof window.toggleRRadarInfo === 'function') {
      // 關閉後重開以重算座標（toggle: close → reopen）
      rPanel.classList.remove('open');
      window.toggleRRadarInfo({ target: rBtn });
    }
  }
});
