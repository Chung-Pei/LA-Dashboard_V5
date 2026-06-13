'use strict';

document.addEventListener('DOMContentLoaded', function () {

  // ── 共用：fixed popover 定位函式 ─────────────────────────────────
  function positionFixed(popover, anchorEl) {
    var rect = anchorEl.getBoundingClientRect();
    var vpW  = window.innerWidth;
    var popW = popover.offsetWidth || parseInt(popover.style.width) || 340;
    var left = rect.left;
    if (left + popW > vpW - 8) left = vpW - popW - 8;
    if (left < 8) left = 8;
    popover.style.top  = (rect.bottom + 6) + 'px';
    popover.style.left = left + 'px';
  }

  // ── R2 排除資料說明 popover ──────────────────────────────────────
  var r2OpenBtn  = document.getElementById('r2ExcludeInfoBtn');
  var r2CloseBtn = document.getElementById('r2ExcludeCloseBtn');
  var r2Popover  = document.getElementById('r2ExcludePopover');

  if (r2OpenBtn && r2Popover) {
    r2OpenBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var isOpen = r2Popover.style.display === 'block';
      if (!isOpen) {
        r2Popover.style.display = 'block';
        positionFixed(r2Popover, r2OpenBtn);
      } else {
        r2Popover.style.display = 'none';
      }
    });
  }
  if (r2CloseBtn && r2Popover) {
    r2CloseBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      r2Popover.style.display = 'none';
    });
  }

  // ── bStatsHelpPanel fixed 定位補丁 ──────────────────────────────
  // main.js 以 data-action 委派控制顯示，此處只補 position:fixed 的座標
  var bBtn   = document.getElementById('bStatsHelpBtn');
  var bPanel = document.getElementById('bStatsHelpPanel');

  if (bBtn && bPanel) {
    // 攔截 main.js 之前（capture phase），顯示後立即定位
    bBtn.addEventListener('click', function () {
      // 等 main.js 切換 display 後再定位（rAF）
      requestAnimationFrame(function () {
        if (bPanel.style.display !== 'none') {
          positionFixed(bPanel, bBtn);
        }
      });
    }, true); // capture:true 確保在 main.js bubble 之前執行

    // hidePanel 按鈕（× 關閉）不需要處理，main.js 已處理 display:none
  }

  // ── 全體相關性計算說明 collapsible ──────────────────────────────
  var corrBtn  = document.getElementById('corrInfoToggleBtn');
  var corrBody = document.getElementById('corrInfoBody');
  var corrIcon = document.getElementById('corrInfoIcon');

  if (corrBtn && corrBody) {
    corrBtn.addEventListener('click', function () {
      var isOpen = corrBody.style.display !== 'none';
      corrBody.style.display = isOpen ? 'none' : 'block';
      if (corrIcon) corrIcon.textContent = isOpen ? '▶' : '▼';
    });
  }

  // ── 點擊外部關閉所有 fixed popover ──────────────────────────────
  document.addEventListener('click', function (e) {
    if (r2Popover && r2Popover.style.display === 'block') {
      if (!r2Popover.contains(e.target) && e.target !== r2OpenBtn) {
        r2Popover.style.display = 'none';
      }
    }
    if (bPanel && bPanel.style.display === 'block') {
      if (!bPanel.contains(e.target) && e.target !== bBtn) {
        bPanel.style.display = 'none';
      }
    }
  });

  // ── 視窗縮放時重新定位 ───────────────────────────────────────────
  window.addEventListener('resize', function () {
    if (r2Popover && r2Popover.style.display === 'block') positionFixed(r2Popover, r2OpenBtn);
    if (bPanel && bPanel.style.display === 'block') positionFixed(bPanel, bBtn);
  });

});
