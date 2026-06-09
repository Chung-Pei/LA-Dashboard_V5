/**
 * print-panel.js  —  LA DASH 列印面板
 *
 * 功能：
 *   - 動態生成 printSelections 勾選清單（21 個圖表項目）
 *   - 學期範圍篩選（printYearStart / printYearEnd）
 *   - 預覽列印：在 printPreviewArea 渲染靜態 HTML
 *   - 直接列印 / 另存 PDF：開啟獨立視窗呼叫 window.print()
 *   - 捕捉方式：
 *       Chart.js canvas → toBase64Image()（或 canvas.toDataURL()）
 *       SVG / HTML DOM  → cloneNode(true) 序列化
 *
 * 依賴（均為全域變數，由先行 defer 腳本提供）：
 *   Chart               — Chart.js v3+（static Chart.getChart(canvas)）
 *   BehaviorLoader      — behavior-loader.js
 *   ChartRegistry       — chart-registry.js（可選；備援用 Chart.getChart）
 *
 * 初始化：
 *   - 以 MutationObserver 偵測 panelP 的 display 切換
 *   - 首次顯示時自動執行 _init()（只初始化一次）
 *
 * 版本：v1.0  2026-06-08
 */

const PrintPanel = (() => {
  'use strict';

  // ── 列印項目定義表 ────────────────────────────────────────────
  // type: 'canvas' → 用 Chart.js toBase64Image()
  //       'svg'    → 直接 cloneNode SVG 容器 innerHTML
  //       'dom'    → cloneNode HTML 元素 outerHTML
  // domId: 要擷取的 DOM 元素 id
  // label: 顯示名稱
  // tab: 所屬頁籤（僅供 print-choice 標籤顯示）
  const PRINT_ITEMS = [
    // ── 整體分析（Panel D）──────────────────────────────────────
    { id: 'chartCohortTrend',   label: '整屆跨學期趨勢',       tab: '整體',   type: 'canvas' },
    { id: 'chartPassRateRange', label: '各學期及格率分布',     tab: '整體',   type: 'canvas' },
    { id: 'heatmapWrap',        label: '學期成績熱力圖',       tab: '整體',   type: 'dom'    },
    { id: 'boxplotWrap',        label: '成績箱型圖',           tab: '整體',   type: 'dom'    },
    { id: 'chartCorrelation',   label: '與行為指標相關性',     tab: '整體',   type: 'canvas' },
    // ── 單學期分析（Panel A）────────────────────────────────────
    { id: 'chartDist',          label: '成績分布直方圖',       tab: '單學期', type: 'canvas' },
    { id: 'chartMidFinal',      label: '期中／期末對比',       tab: '單學期', type: 'canvas' },
    { id: 'chartTrend',         label: '各班趨勢折線',         tab: '單學期', type: 'canvas' },
    { id: 'chartNormalOverlay', label: '常態分布疊加',         tab: '單學期', type: 'canvas' },
    { id: 'chartRegression',    label: '迴歸分析',             tab: '單學期', type: 'canvas' },
    { id: 'chartVariance',      label: '變異分析',             tab: '單學期', type: 'canvas' },
    // ── 行為分群雷達（Panel L / sub-radar）──────────────────────
    { id: 'radarChart',         label: '學習行為分群雷達圖',   tab: '行為',   type: 'canvas' },
    // ── 行為相關性（Panel L / sub-correlation）──────────────────
    { id: 'corrHeatmap',        label: '行為相關係數矩陣',     tab: '行為',   type: 'dom'    },
    { id: 'scatterChart',       label: '行為相關性散佈圖',     tab: '行為',   type: 'canvas' },
    // ── 時間分析（Panel L / sub-time）───────────────────────────
    { id: 'weeklyQuizChart',    label: '各週題庫作答強度',     tab: '時間',   type: 'canvas' },
    { id: 'preExamChart',       label: '平時及考前學習強度',   tab: '時間',   type: 'canvas' },
    { id: 'timeSlotChart',      label: '學習時段分布',         tab: '時間',   type: 'canvas' },
    { id: 'studyHeatmapWrap',   label: '學習規律熱力圖',       tab: '時間',   type: 'svg'    },
    { id: 'hourlyLineChart',    label: '24 小時學習趨勢',      tab: '時間',   type: 'canvas' },
    // ── LSA 行為序列（Panel L / sub-lsa）───────────────────────
    { id: 'lsaGraphWrap',       label: 'LSA 行為序列轉移圖',   tab: 'LSA',    type: 'svg'    },
    { id: 'lsaInterpretCard',   label: 'LSA 白話解讀',         tab: 'LSA',    type: 'dom'    },
  ];

  // ── 狀態 ─────────────────────────────────────────────────────
  let _initialized = false;

  // ── 公開 API ──────────────────────────────────────────────────
  function init() {
    if (_initialized) return;
    _initialized = true;
    _buildCheckboxes();
    _populateYearSelects();
    _bindActions();
  }

  // ── 建立勾選清單 ──────────────────────────────────────────────
  function _buildCheckboxes() {
    const container = document.getElementById('printSelections');
    if (!container) return;

    container.innerHTML = PRINT_ITEMS.map(item => `
      <label class="print-choice selected" data-print-id="${item.id}">
        <input type="checkbox" value="${item.id}" checked>
        <span class="print-tab">${item.tab}</span>
        <span class="print-label">${item.label}</span>
      </label>`).join('');

    // 勾選/取消 → 更新 .selected 樣式 + 摘要
    container.addEventListener('change', e => {
      if (e.target.type !== 'checkbox') return;
      const label = e.target.closest('.print-choice');
      if (label) label.classList.toggle('selected', e.target.checked);
      _updateSummary();
    });

    _updateSummary();
  }

  // ── 更新摘要文字 ──────────────────────────────────────────────
  function _updateSummary() {
    const el = document.getElementById('printSummary');
    if (!el) return;
    const total    = PRINT_ITEMS.length;
    const selected = document.querySelectorAll('#printSelections input[type="checkbox"]:checked').length;
    el.textContent = `已選 ${selected} / ${total} 個項目`;
  }

  // ── 填入學期下拉清單 ──────────────────────────────────────────
  // 從 corrSemFilter（行為相關性頁籤初始化後注入的學期下拉）讀取學期清單。
  // 若相關性頁籤尚未初始化，sems=[] → 顯示「全部學期」佔位選項。
  function _populateYearSelects() {
    const startEl = document.getElementById('printYearStart');
    const endEl   = document.getElementById('printYearEnd');
    if (!startEl || !endEl) return;

    // 從 corrSemFilter（行為相關性頁籤已渲染的學期下拉）讀取學期清單
    // 比存取私有 BehaviorLoader._cache 更可靠
    const corrSemSel = document.getElementById('corrSemFilter');
    const sems = corrSemSel
      ? [...corrSemSel.options]
          .map(o => o.value)
          .filter(v => v && v !== 'all')
      : [];

    if (!sems.length) {
      [startEl, endEl].forEach(el => {
        el.innerHTML = '<option value="">（全部學期）</option>';
      });
      return;
    }

    const opts = sems.map(s => `<option value="${s}">${_formatSem(s)}</option>`).join('');
    startEl.innerHTML = opts;
    endEl.innerHTML   = opts;
    endEl.selectedIndex = endEl.options.length - 1;   // 預設 end = 最新學期
  }

  // 學期代碼格式化：1111 → 111(1)、1112 → 111(2)
  function _formatSem(sem) {
    const s = String(sem);
    if (s.length === 4) return `${s.slice(0, 3)}(${s.slice(3)})`;
    return s;
  }

  // ── 綁定 data-action 按鈕 ─────────────────────────────────────
  // main.js 的事件委派已處理全域 click；這裡在 panelP 內額外綁定，
  // 以防 main.js 沒有實作 doPrintPreview / doPrint。
  function _bindActions() {
    const panel = document.getElementById('panelP');
    document.addEventListener('click', e => {
      if (panel && !panel.contains(e.target)) return;  // 只處理 panelP 內的點擊
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (!action) return;
      if (action === 'doPrintPreview')    { e.stopImmediatePropagation(); _doPreview(); }
      if (action === 'doPrint')           { e.stopImmediatePropagation(); _doPrint();   }
      if (action === 'printSelectAll')    { _setAllChecked(true);  }
      if (action === 'printClearAll')     { _setAllChecked(false); }
      if (action === 'closePrintPreview') {
        const area = document.getElementById('printPreviewArea');
        if (area) area.style.display = 'none';
      }
    }, true);
  }

  function _setAllChecked(checked) {
    document.querySelectorAll('#printSelections input[type="checkbox"]').forEach(cb => {
      cb.checked = checked;
      const label = cb.closest('.print-choice');
      if (label) label.classList.toggle('selected', checked);
    });
    _updateSummary();
  }

  // ── 取得勾選的項目 id 清單 ────────────────────────────────────
  function _selectedIds() {
    return [...document.querySelectorAll('#printSelections input[type="checkbox"]:checked')]
      .map(cb => cb.value);
  }

  // ── 取得有效學期範圍 ──────────────────────────────────────────
  function _semRange() {
    const s = document.getElementById('printYearStart')?.value;
    const e = document.getElementById('printYearEnd')?.value;
    return { start: s || null, end: e || null };
  }

  // ── 擷取單一項目為 HTML 字串 ──────────────────────────────────
  function _captureItem(item) {
    const el = document.getElementById(item.id);
    if (!el) return null;

    if (item.type === 'canvas') {
      // 用 Chart.js 靜態方法取得 chart 實例（v3.x API）
      let dataUrl = null;
      try {
        const chart = Chart.getChart(el);
        if (chart) {
          dataUrl = chart.toBase64Image('image/png', 1);
        }
      } catch (_) { /* Chart.js 未就緒 */ }

      // 備援：直接讀 canvas
      if (!dataUrl) {
        try { dataUrl = el.toDataURL('image/png'); } catch (_) { return null; }
      }
      if (!dataUrl || dataUrl === 'data:,') return null;

      return `<img src="${dataUrl}" style="max-width:100%;height:auto;display:block" alt="${item.label}">`;
    }

    if (item.type === 'svg') {
      // studyHeatmapWrap / lsaGraphWrap：取 innerHTML（含 SVG 標籤）
      const inner = el.innerHTML.trim();
      if (!inner) return null;
      return `<div style="overflow-x:auto">${inner}</div>`;
    }

    if (item.type === 'dom') {
      // corrHeatmap / heatmapWrap / boxplotWrap / lsaInterpretCard 等
      const clone = el.cloneNode(true);
      // 移除互動用屬性避免列印干擾
      clone.querySelectorAll('[data-tip],[data-action]').forEach(node => {
        node.removeAttribute('data-tip');
        node.removeAttribute('data-action');
      });
      clone.querySelectorAll('.chart-expand-btn,.chart-info-btn,.chart-popover').forEach(n => n.remove());
      return clone.outerHTML;
    }

    return null;
  }

  // ── 組裝完整列印 HTML ─────────────────────────────────────────
  const _PREVIEW_STYLE_ID = 'print-panel-preview-style';

  function _injectPreviewStyles() {
    if (document.getElementById(_PREVIEW_STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = _PREVIEW_STYLE_ID;
    s.textContent = _previewCSS();
    document.head.appendChild(s);
  }

  function _buildPrintHTML(selectedIds, forWindow = false) {
    const { start, end } = _semRange();
    const semLabel = (start && end) ? `學期範圍：${_formatSem(start)} – ${_formatSem(end)}` : '全部學期';
    const now = new Date().toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });

    const pages = [];

    for (const id of selectedIds) {
      const item = PRINT_ITEMS.find(i => i.id === id);
      if (!item) continue;

      const content = _captureItem(item);
      if (!content) {
        // 項目存在但無內容（頁籤未渲染）
        pages.push(`
          <div class="print-page">
            <div class="print-page-header">
              <span class="print-page-tab">${item.tab}</span>
              <span class="print-page-title">${item.label}</span>
            </div>
            <div class="print-empty">⚠️ 此圖表尚未載入，請先切換至對應頁籤再執行列印。</div>
          </div>`);
        continue;
      }

      pages.push(`
        <div class="print-page">
          <div class="print-page-header">
            <span class="print-page-tab">${item.tab}</span>
            <span class="print-page-title">${item.label}</span>
          </div>
          <div class="print-page-body">${content}</div>
        </div>`);
    }

    if (!pages.length) {
      return '<p style="padding:20px;color:#888">未選擇任何列印項目。</p>';
    }

    const header = `
      <div class="print-doc-header">
        <strong>LA DASH 學習分析儀表板</strong>
        <span>${semLabel}</span>
        <span>列印日期：${now}</span>
      </div>`;

    if (forWindow) {
      return `<!DOCTYPE html><html lang="zh-TW"><head>
        <meta charset="UTF-8">
        <title>LA DASH 列印</title>
        <style>${_windowCSS()}</style>
      </head><body>${header}${pages.join('')}</body></html>`;
    }

    // 預覽模式：樣式由 _injectPreviewStyles() 寫入 <head>
    return `${header}${pages.join('')}`;
  }

  // ── CSS ───────────────────────────────────────────────────────
  // _previewCSS(): 所有規則 scope 至 #printPreviewContent，
  //   安全注入 <head> 而不污染 app 全域樣式（body / svg 等）
  // _windowCSS():  獨立列印視窗用，全域無 scope，包含 @media print
  function _previewCSS() {
    return `
      #printPreviewContent * { box-sizing: border-box; }
      #printPreviewContent {
        font-family: 'Noto Sans TC', 'PingFang TC', sans-serif;
        color: #1a1a2e; background: #fff;
      }
      #printPreviewContent .print-doc-header {
        display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
        padding: 10px 16px; border-bottom: 2px solid #3498db;
        font-size: 12px; color: #555; margin-bottom: 12px;
      }
      #printPreviewContent .print-doc-header strong { font-size: 14px; color: #1a1a2e; }
      #printPreviewContent .print-page {
        background: #fff; border: 1px solid #dde; border-radius: 6px;
        margin-bottom: 16px; padding: 14px 16px;
      }
      #printPreviewContent .print-page-header {
        display: flex; align-items: center; gap: 8px;
        border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 12px;
      }
      #printPreviewContent .print-page-tab {
        font-size: 10px; background: #e8f0fe; color: #3498db;
        border-radius: 4px; padding: 2px 7px; font-weight: 600; white-space: nowrap;
      }
      #printPreviewContent .print-page-title { font-size: 13px; font-weight: 600; color: #1a1a2e; }
      #printPreviewContent .print-page-body img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
      #printPreviewContent .print-page-body table { width: 100%; border-collapse: collapse; font-size: 11px; }
      #printPreviewContent .print-page-body td,
      #printPreviewContent .print-page-body th { border: 1px solid #dde; padding: 4px 8px; }
      #printPreviewContent .print-page-body th { background: #f5f7fa; font-weight: 600; }
      #printPreviewContent .print-empty { color: #e67e22; font-size: 12px; padding: 12px 0; }
      #printPreviewContent svg { max-width: 100%; height: auto; }
    `;
  }

  function _windowCSS() {
    return `
      * { box-sizing: border-box; }
      body { font-family: 'Noto Sans TC', 'PingFang TC', sans-serif; color: #1a1a2e; background: #fff; margin: 0; padding: 0; }
      .print-doc-header {
        display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
        padding: 10px 16px; border-bottom: 2px solid #3498db;
        font-size: 12px; color: #555; margin-bottom: 12px;
      }
      .print-doc-header strong { font-size: 14px; color: #1a1a2e; }
      .print-page {
        background: #fff; border: 1px solid #dde; border-radius: 6px;
        margin-bottom: 16px; padding: 14px 16px; break-inside: avoid; page-break-inside: avoid;
      }
      .print-page-header {
        display: flex; align-items: center; gap: 8px;
        border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 12px;
      }
      .print-page-tab {
        font-size: 10px; background: #e8f0fe; color: #3498db;
        border-radius: 4px; padding: 2px 7px; font-weight: 600; white-space: nowrap;
      }
      .print-page-title { font-size: 13px; font-weight: 600; color: #1a1a2e; }
      .print-page-body img { max-width: 100%; height: auto; display: block; border-radius: 4px; }
      .print-page-body table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .print-page-body td, .print-page-body th { border: 1px solid #dde; padding: 4px 8px; }
      .print-page-body th { background: #f5f7fa; font-weight: 600; }
      .print-empty { color: #e67e22; font-size: 12px; padding: 12px 0; }
      svg { max-width: 100%; height: auto; }
      @media print {
        body { padding: 0; }
        .print-page { border: none; page-break-after: always; margin: 0; padding: 10px 0; }
        .print-page:last-child { page-break-after: avoid; }
        @page { margin: 15mm 12mm; size: A4 landscape; }
      }
    `;
  }

  // ── 預覽列印 ──────────────────────────────────────────────────
  function _doPreview() {
    const ids = _selectedIds();
    const area    = document.getElementById('printPreviewArea');
    const content = document.getElementById('printPreviewContent');
    if (!area || !content) return;

    if (!ids.length) {
      content.innerHTML = '<p style="padding:20px;color:#e67e22">請先勾選至少一個列印項目。</p>';
      area.style.display = 'block';
      return;
    }

    content.innerHTML = '<p style="padding:20px;color:#888">⏳ 正在擷取圖表...</p>';
    area.style.display = 'block';
    _injectPreviewStyles();   // 樣式寫入 <head>，不污染 innerHTML

    // 非同步讓瀏覽器先繪製「正在擷取」提示
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        content.innerHTML = _buildPrintHTML(ids, false);
        area.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ── 直接列印 ─────────────────────────────────────────────────
  function _doPrint() {
    const ids = _selectedIds();
    if (!ids.length) {
      alert('請先勾選至少一個列印項目。');
      return;
    }

    const html = _buildPrintHTML(ids, true);
    const win  = window.open('', '_blank', 'width=1100,height=800');
    if (!win) { alert('彈出視窗被封鎖，請允許本頁開啟新視窗後重試。'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();

    win.addEventListener('load', () => {
      setTimeout(() => { win.focus(); win.print(); }, 300);
    });
  }

  // ── 以 MutationObserver 偵測 panelP 首次顯示 ─────────────────
  function _observePanelP() {
    const panel = document.getElementById('panelP');
    if (!panel) return;

    // 若已是 active，直接初始化
    if (panel.classList.contains('active') ||
        getComputedStyle(panel).display !== 'none') {
      init(); return;
    }

    const obs = new MutationObserver(() => {
      if (panel.classList.contains('active') ||
          getComputedStyle(panel).display !== 'none') {
        obs.disconnect();
        init();
      }
    });
    obs.observe(panel, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  // ── 啟動 ─────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _observePanelP);
  } else {
    _observePanelP();
  }

  return { init };
})();
