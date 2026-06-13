'use strict';

document.addEventListener('DOMContentLoaded', function () {

  // ── R2 排除資料說明 popover ──────────────────────────────────────
  var openBtn  = document.getElementById('r2ExcludeInfoBtn');
  var closeBtn = document.getElementById('r2ExcludeCloseBtn');
  var popover  = document.getElementById('r2ExcludePopover');

  if (openBtn && popover) {
    openBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      popover.style.display = (popover.style.display === 'block') ? 'none' : 'block';
    });
  }
  if (closeBtn && popover) {
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      popover.style.display = 'none';
    });
  }
  // 點擊 popover 以外區域關閉
  document.addEventListener('click', function (e) {
    if (popover && popover.style.display === 'block') {
      if (!popover.contains(e.target) && e.target !== openBtn) {
        popover.style.display = 'none';
      }
    }
  });

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

});
