'use strict';

// ui-toggles.js
// 職責：
//   1. r2ExcludePopover  — 開/關 + position:fixed 定位（無 data-action，main.js 不處理）
//   2. bStatsHelpPanel   — 僅補 position:fixed 定位（main.js stopPropagation 後我們收不到 click）
//                          改用 MutationObserver 監聽 display 變化
//   3. corrInfoToggleBtn — 摺疊展開（無 data-action）

function positionFixed(popover, anchorEl) {
  var rect    = anchorEl.getBoundingClientRect();
  var vpW     = window.innerWidth;
  // offsetWidth 在 display:block 後讀取；若仍為 0（首次渲染競態）用 data-maxw fallback
  var maxW    = parseInt(popover.dataset.maxw || '360', 10);
  var popW    = popover.offsetWidth || Math.min(vpW * 0.88, maxW);
  var left    = rect.left;
  if (left + popW > vpW - 8) left = vpW - popW - 8;
  if (left < 8) left = 8;
  popover.style.top  = (rect.bottom + 6) + 'px';
  popover.style.left = left + 'px';
}

// ── bStatsHelpPanel：MutationObserver 補定位 ─────────────────────────
// main.js 的 toggleBStatsHelp 在 stopPropagation 後控制 display，
// 我們監聽 style 屬性變化，display 變為非 none 時定位。
(function () {
  var panel = null;
  var btn   = null;
  var observer = null;

  function init() {
    panel = document.getElementById('bStatsHelpPanel');
    btn   = document.getElementById('bStatsHelpBtn');
    if (!panel || !btn) return;

    observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'style') {
          // at-risk-report.js 開啟時設 display=''（非 'block'），關閉時設 'none'
          if (panel.style.display !== 'none') {
            positionFixed(panel, btn);
          }
        }
      }
    });
    observer.observe(panel, { attributes: true, attributeFilter: ['style'] });
  }

  // at-risk-report.js 是 defer，DOMContentLoaded 後元素已存在
  document.addEventListener('DOMContentLoaded', init);
})();

// ── r2ExcludePopover & corrInfoToggleBtn：bubble phase click 委派 ────
// 這兩個按鈕沒有 data-action，main.js 不處理，也不 stopPropagation
document.addEventListener('click', function (e) {

  // R2 排除資料說明：開啟按鈕
  var r2Btn = e.target.closest('#r2ExcludeInfoBtn');
  if (r2Btn) {
    var pop = document.getElementById('r2ExcludePopover');
    if (!pop) return;
    var isOpen = pop.style.display === 'block';
    pop.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) positionFixed(pop, r2Btn);
    return;
  }

  // R2 排除資料說明：關閉按鈕（×）
  if (e.target.closest('#r2ExcludeCloseBtn')) {
    var pop2 = document.getElementById('r2ExcludePopover');
    if (pop2) pop2.style.display = 'none';
    return;
  }

  // corrInfo 摺疊
  if (e.target.closest('#corrInfoToggleBtn')) {
    var body = document.getElementById('corrInfoBody');
    var icon = document.getElementById('corrInfoIcon');
    if (!body) return;
    var open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (icon) icon.textContent = open ? '▶' : '▼';
    return;
  }

  // 點擊外部關閉 r2Popover
  // （bStatsHelpPanel 由 main.js hidePanel data-action 關閉，不重複處理）
  var r2Pop = document.getElementById('r2ExcludePopover');
  if (r2Pop && r2Pop.style.display === 'block') {
    if (!r2Pop.contains(e.target)) r2Pop.style.display = 'none';
  }

});

// resize 時重新定位
window.addEventListener('resize', function () {
  var r2Pop = document.getElementById('r2ExcludePopover');
  var r2Btn = document.getElementById('r2ExcludeInfoBtn');
  if (r2Pop && r2Btn && r2Pop.style.display === 'block') positionFixed(r2Pop, r2Btn);

  var bPanel = document.getElementById('bStatsHelpPanel');
  var bBtn   = document.getElementById('bStatsHelpBtn');
  if (bPanel && bBtn && bPanel.style.display !== 'none') positionFixed(bPanel, bBtn);
});
