/**
 * tab-behavior-cross.js  —  v1.0
 *
 * 行為預測分析 sub-tab（第5個，掛載於 sub-lsa 之後）。
 * MVP 範圍（依規劃 Phase 3）：
 *   ① R群 / S群 不及格率長條圖（Chart.js）
 *   ② Alert Card：自動偵測高風險 R×S 組合（>25%）
 *   ③ BAS / QMI 摘要卡
 *
 * 資料來源：BehaviorLoader.load.crossAnalysis() → data/cross_analysis.json
 * 沿用既有色表（CLUSTER_NAMES 對應 R1-R5，與 tab-behavior-radar.js 一致）
 */

const BehaviorCrossTab = (() => {

  let _crossData = null;
  let _chart = null;
  let _trajChart = null;
  let _approachChart = null;

  const CLUSTER_NAMES = { R1:"影音輔導型", R2:"彈性聽覺型", R3:"平均使用型", R4:"題庫刷題型", R5:"被動低參與型" };
  const S_NAMES       = { S1:"高主動切換型", S2:"均衡切換型", S3:"教材持續型", S4:"被動序列型", S5:"序列不足" };

  const COLORS = {
    R1: "#3498db", R2: "#9b59b6", R3: "#2ecc71", R4: "#e67e22", R5: "#e74c3c",
    S1: "#1abc9c", S2: "#3498db", S3: "#2ecc71", S4: "#e67e22", S5: "#95a5a6",
  };

  const ALERT_THRESHOLD = 0.25; // 高出基準的不及格率即列入 Alert Card
  const LOW_SAMPLE_MIN = 5;     // n < 5 視為樣本不足（與 11_cross_analysis.py 一致）

  // ── 樣式防重複注入（ARCH-3 FIX）────────────────────────────
  function _injectStyleOnce(id, css) {
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = css;
    document.head.appendChild(el);
  }

  const _STYLES = {
    summaryCard: `
      .cross-stat-box{padding:10px;border-radius:6px;background:var(--surface2,#1c2030);
                      border:1px solid var(--border2,#2a2f45)}
      .cross-stat-label{font-size:0.72rem;color:var(--text-dim,#888);margin-bottom:4px}
      .cross-stat-value{font-size:1.1rem;font-weight:600;color:var(--text,#eee)}
      .cross-stat-sub{font-size:0.68rem;color:var(--text-dim,#888);margin-top:2px}`,
    alertCard: `
      .cross-alert-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
                       padding:8px 10px;margin-bottom:6px;border-radius:6px;
                       background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.18)}
      .cross-alert-badge{padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600}
      .cross-alert-stat{font-size:0.78rem;color:var(--text-dim,#888);margin-left:auto}`,
    heatmap: `
      .cross-heatmap-grid{display:grid;grid-template-columns:90px repeat(5,1fr);gap:3px}
      .cross-heatmap-cell{padding:6px 4px;text-align:center;border-radius:4px;min-height:48px;
                           display:flex;flex-direction:column;align-items:center;justify-content:center}
      .cross-heatmap-corner{background:transparent}
      .cross-heatmap-header{background:var(--surface2,#1c2030)}
      .cross-heatmap-data{cursor:pointer;transition:transform .12s,box-shadow .12s}
      .cross-heatmap-data:hover,.cross-heatmap-data:focus{
        transform:scale(1.04);box-shadow:0 0 0 2px var(--accent,#3498db);outline:none}
      .cross-heatmap-empty{
        background:repeating-linear-gradient(45deg,rgba(150,150,150,0.12),rgba(150,150,150,0.12) 4px,
                   transparent 4px,transparent 8px);
        border:1px dashed rgba(150,150,150,0.3)}
      .cross-legend-swatch{display:inline-block;width:14px;height:14px;border-radius:3px;
                            vertical-align:middle;margin-right:2px}
      .cross-legend-hatch{
        background:repeating-linear-gradient(45deg,rgba(150,150,150,0.25),rgba(150,150,150,0.25) 3px,
                   transparent 3px,transparent 6px);
        border:1px dashed rgba(150,150,150,0.4)}`,
    legend: `
      .cross-legend-card{
        margin:12px 0;border-radius:8px;overflow:hidden;
        border:1px solid var(--border2,#2a2f45);background:var(--surface2,#1c2030)}
      .cross-legend-summary{
        display:flex;align-items:center;gap:8px;padding:9px 14px;
        font-size:0.82rem;font-weight:600;color:var(--text-dim,#aaa);
        cursor:pointer;user-select:none;list-style:none;border-radius:8px;
        transition:background .15s,color .15s}
      .cross-legend-summary::-webkit-details-marker{display:none}
      .cross-legend-summary:hover{background:rgba(255,255,255,.04);color:var(--text,#eee)}
      .cross-legend-card[open]>.cross-legend-summary{
        color:var(--text,#eee);border-radius:8px 8px 0 0;
        border-bottom:1px solid var(--border2,#2a2f45)}
      .cross-legend-summary-icon{
        display:inline-block;font-size:0.65rem;
        transition:transform .2s ease;color:var(--accent,#3498db)}
      .cross-legend-card[open] .cross-legend-summary-icon{transform:rotate(90deg)}
      .cross-legend-body{padding:12px 14px;overflow-x:auto}
      .cross-legend-table{width:100%;border-collapse:collapse;font-size:0.8rem;line-height:1.55}
      .cross-legend-table th{
        text-align:left;padding:6px 10px;font-size:0.75rem;font-weight:600;
        color:var(--text-dim,#888);border-bottom:1px solid var(--border2,#2a2f45);white-space:nowrap}
      .cross-legend-table td{
        padding:7px 10px;color:var(--text,#eee);vertical-align:top;
        border-bottom:1px solid rgba(255,255,255,.04)}
      .cross-legend-table tr:last-child td{border-bottom:none}
      .cross-legend-table tbody tr:hover td{background:rgba(255,255,255,.03)}
      .cross-legend-code{font-weight:700;font-size:0.85rem;white-space:nowrap}
      .cross-legend-note{margin:8px 0 0;font-size:0.72rem;color:var(--text-dim,#777);line-height:1.5}`,
  };

  function _safeText(s) {
    return typeof escapeHtml === "function" ? escapeHtml(String(s)) : String(s);
  }

  function _pct(x) {
    return (x == null) ? "—" : (x * 100).toFixed(1) + "%";
  }

  // ── ARCH-4 FIX: 渲染階段容錯隔離 ──────────────────────────
  // 原版 init() 內各 _render* 函式無獨立保護，任一函式因資料欄位
  // 缺失（如 bas_validation / spearman 結構不符預期）拋出例外時，
  // 會中斷 init() 同步呼叫鏈，導致後續所有圖表「無聲消失」且
  // 畫面無任何錯誤提示。改為逐一隔離執行，單一卡片失敗不影響其他。
  function _safeRender(label, fn) {
    try {
      fn();
    } catch (e) {
      console.error(`[BehaviorCrossTab] ${label} 渲染失敗:`, e);
    }
  }

  // ── 初始化 ──────────────────────────────────────────────
  async function init() {
    try {
      _crossData = await BehaviorLoader.load.crossAnalysis();
    } catch (e) {
      console.error("[BehaviorCrossTab] load error:", e);
      _renderEmpty("cross_analysis.json 載入失敗，請確認 ETL 是否已執行 11_cross_analysis.py。");
      throw e;
    }

    if (!_crossData || !_crossData.overall) {
      _renderEmpty("ETL 尚未產出跨模組分析資料，請執行 11_cross_analysis.py 後重整頁面。");
      return;
    }

    _safeRender("資料範圍說明", _renderScopeNote);
    _safeRender("BAS/QMI 摘要卡", _renderSummaryCard);
    _safeRender("高風險組合警示", _renderAlertCard);
    _safeRender("R群/S群長條圖", _renderGroupChart);
    _safeRender("R×S 熱力圖", _renderHeatmap);
    _safeRender("分析框架說明卡", _renderLegendCards);
    _safeRender("軌跡分型堆疊圖", _renderTrajectoryChart);
    _safeRender("學習方法堆疊圖", _renderApproachChart);
  }

  // ── 動態更新資料範圍說明（不鎖死特定學期）─────────────────
  function _renderScopeNote() {
    const el = document.getElementById("crossScopeNote");
    if (!el) return;

    const meta = _crossData.meta || {};
    const excluded = meta.incomplete_semesters_excluded || [];
    const semNote = excluded.length
      ? `尚無期末成績的最新學期（${excluded.map(_safeText).join(', ')}）為驗證學期，不納入相關性計算`
      : `目前所有學期皆已有期末成績`;

    // INTEG-1: 被動讀取 BehaviorLoader.loadWarningForCurrentTarget() 設置的
    // window._latestWarningValidation（原版寫入後從未被任何 Tab 讀取的死碼）。
    // 此處不主動呼叫 loadWarningForCurrentTarget()，因該載入屬「🔮 提前預警」
    // 分頁的職責；若使用者尚未開過該分頁，此全域變數會是 undefined，此時
    // 略過顯示而非顯示「尚未驗證」字樣，避免誤導為模型本身未經驗證。
    const wv = typeof window !== "undefined" ? window._latestWarningValidation : null;
    const validationNote = wv
      ? `<br>🎯 <strong>預警模型驗證：</strong>第 ${_safeText(wv.semester)} 學期，
         驗證日期 ${_safeText(wv.date)}，HIGH 風險組校準誤差 ${_safeText(wv.highErrorPp)}pp`
      : "";

    el.innerHTML = `
      ℹ️ <strong>資料範圍說明：</strong>
      本分析僅納入正課（theory）學生，實習科目（practicum）採30分制計分且60%成績未記入學習系統，已完全排除。
      訓練集為已有期末成績之學期（n=${meta.n_with_final ?? '—'}）；
      ${semNote}，
      可於「🔮 提前預警」分頁單獨查看其預警名單。${validationNote}
    `;
  }

  function resetFilters() {
    // MVP 無篩選器，保留接口以符合 resetBehaviorFilters 慣例
  }

  function _renderEmpty(msg) {
    const el = document.getElementById("sub-cross");
    if (!el) return;
    el.innerHTML = `<p style="color:#c0392b;font-size:0.85rem;padding:12px">⚠️ ${_safeText(msg)}</p>`;
  }

  // ── ① BAS / QMI 摘要卡 ──────────────────────────────────
  function _renderSummaryCard() {
    const wrap = document.getElementById("crossSummaryCard");
    if (!wrap) return;

    const o = _crossData.overall;
    const sp = _crossData.spearman || {};
    const bv = _crossData.bas_validation || {};
    const meta = _crossData.meta || {};

    // ARCH-4 FIX: qmi_quintiles 缺失或為空陣列時降級顯示，
    // 而非直接存取 q[0] 拋出 TypeError 拖垮整個 init() 呼叫鏈。
    const q = Array.isArray(bv.qmi_quintiles) ? bv.qmi_quintiles : [];
    const q1 = q[0] ?? null, q5 = q[q.length - 1] ?? null;
    const rSp = sp.r_group_vs_final || {};
    const sSp = sp.s_group_vs_final || {};
    const approach = o.approach || {};

    wrap.innerHTML = `
      <div style="font-size:0.82rem;line-height:1.7">
        <div style="margin-bottom:8px;padding:8px 10px;border-radius:6px;
                    background:rgba(100,160,255,0.07);border:1px solid rgba(100,160,255,0.2)">
          ℹ️ 訓練集：111-1–114-1（n=${o.n}），排除實習科目與
          ${(meta.incomplete_semesters_excluded||[]).join(', ')}（驗證學期）
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
          <div class="cross-stat-box">
            <div class="cross-stat-label">全體不及格率</div>
            <div class="cross-stat-value">${_pct(o.fail_rate_final)}</div>
            <div class="cross-stat-sub">期中 ${_pct(o.fail_rate_midterm)}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">BAS 複合評分</div>
            <div class="cross-stat-value">r = ${bv.bas_r?.r ?? '—'}</div>
            <div class="cross-stat-sub">期中×0.35 + QMI×0.30 + (1−被動)×0.20 + 練習×0.15</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">QMI 五分位梯度</div>
            <div class="cross-stat-value">${q1 && q5 ? `${_pct(q1.fail_rate)} → ${_pct(q5.fail_rate)}` : '—'}</div>
            <div class="cross-stat-sub">${q1 && q5 ? `Q1（最低）vs Q5（最高），n=${q1.n}/${q5.n}` : '資料不足'}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">R群 × 期末 Spearman</div>
            <div class="cross-stat-value">ρ = ${rSp.rho ?? '—'}</div>
            <div class="cross-stat-sub">${_safeText(rSp.note || '')}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">S群 × 期末 Spearman</div>
            <div class="cross-stat-value">ρ = ${sSp.rho ?? '—'}</div>
            <div class="cross-stat-sub">${_safeText(sSp.note || '')}</div>
          </div>
          <div class="cross-stat-box">
            <div class="cross-stat-label">學習方法分布</div>
            <div class="cross-stat-value" style="font-size:0.95rem">
              DEEP ${_pct(approach.DEEP)} / SURFACE ${_pct(approach.SURFACE)}
            </div>
            <div class="cross-stat-sub">MODERATE ${_pct(approach.MODERATE)}</div>
          </div>
        </div>
      </div>
    `;
    _injectStyleOnce("__cross-style-summary", _STYLES.summaryCard);
  }

  // ── ② Alert Card：自動偵測高風險 R×S 組合 ────────────────
  function _renderAlertCard() {
    const wrap = document.getElementById("crossAlertCard");
    if (!wrap) return;

    const overall_fail = _crossData.overall.fail_rate_final;
    const matrix = _crossData.cross_matrix || {};
    const alerts = [];

    for (const [rg, row] of Object.entries(matrix)) {
      for (const [sg, cell] of Object.entries(row)) {
        if (cell.low_sample || cell.note || cell.fail_rate_final == null) continue;
        if (cell.fail_rate_final >= ALERT_THRESHOLD) {
          alerts.push({ rg, sg, ...cell });
        }
      }
    }
    alerts.sort((a, b) => b.fail_rate_final - a.fail_rate_final);

    if (alerts.length === 0) {
      wrap.innerHTML = `<p style="font-size:0.8rem;color:var(--text-dim,#888)">
        目前無 R×S 組合不及格率超過 ${(ALERT_THRESHOLD*100).toFixed(0)}%。</p>`;
      return;
    }

    const rows = alerts.map(a => `
      <div class="cross-alert-row">
        <span class="cross-alert-badge" style="background:${COLORS[a.rg]}22;color:${COLORS[a.rg]}">
          ${a.rg} ${CLUSTER_NAMES[a.rg] || ''}
        </span>
        <span style="color:var(--text-dim,#888)">×</span>
        <span class="cross-alert-badge" style="background:${COLORS[a.sg]}22;color:${COLORS[a.sg]}">
          ${a.sg} ${S_NAMES[a.sg] || ''}
        </span>
        <span class="cross-alert-stat">
          不及格率 <strong style="color:#e74c3c">${_pct(a.fail_rate_final)}</strong>
          （高出基準 ${_pct(a.fail_rate_final - overall_fail)}，n=${a.n}）
        </span>
      </div>
    `).join('');

    wrap.innerHTML = `
      <div style="font-size:0.82rem">
        <div style="margin-bottom:8px;font-weight:600">
          ⚠️ 高風險 R×S 組合（不及格率 ≥ ${(ALERT_THRESHOLD*100).toFixed(0)}%）
        </div>
        ${rows}
      </div>
    `;
    _injectStyleOnce("__cross-style-alert", _STYLES.alertCard);
  }

  // ── ③ R群 / S群 不及格率長條圖 ───────────────────────────
  function _renderGroupChart() {
    const canvas = document.getElementById("crossGroupChart");
    if (!canvas || typeof Chart === "undefined") return;

    const overall_fail = _crossData.overall.fail_rate_final;
    const rStats = _crossData.by_r_cluster || {};
    const sStats = _crossData.by_s_cluster || {};

    const labels = [];
    const data = [];
    const bg = [];
    const meta = [];

    for (const code of ["R1","R2","R3","R4","R5"]) {
      const s = rStats[code];
      if (!s) continue;
      labels.push(`${code} ${CLUSTER_NAMES[code]}`);
      if (s.low_sample || s.no_baseline) {
        data.push(0);
        bg.push("rgba(150,150,150,0.25)");
        meta.push(`n=${s.n}（樣本不足/無基準，不計算）`);
      } else {
        data.push(s.fail_rate_final * 100);
        bg.push(COLORS[code]);
        meta.push(`n=${s.n}，期末均值 ${s.final_mean}`);
      }
    }

    labels.push(""); // 分隔
    data.push(null);
    bg.push("transparent");
    meta.push("");

    for (const code of ["S1","S2","S3","S4","S5"]) {
      const s = sStats[code];
      if (!s) continue;
      labels.push(`${code} ${S_NAMES[code]}`);
      if (s.low_sample || s.no_baseline) {
        data.push(0);
        bg.push("rgba(150,150,150,0.25)");
        meta.push(`n=${s.n}（${code==='S5' ? '序列不足' : '樣本不足'}）`);
      } else {
        data.push(s.fail_rate_final * 100);
        bg.push(COLORS[code]);
        meta.push(`n=${s.n}，期末均值 ${s.final_mean}`);
      }
    }

    if (_chart) _chart.destroy();
    _chart = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [{
          label: "期末不及格率 (%)",
          data,
          backgroundColor: bg,
        }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const m = meta[ctx.dataIndex];
                const v = ctx.parsed.x;
                return v == null ? "" : `不及格率 ${v.toFixed(1)}%　${m}`;
              },
            },
          },
          // [垃圾碼已移除] annotation: undefined 對 Chart.js 無效果
        },
        scales: {
          x: {
            title: { display: true, text: "期末不及格率 (%)" },
            min: 0,
          },
        },
      },
      plugins: [{
        // 全體基準虛線
        id: "overallLine",
        afterDraw: (chart) => {
          const xScale = chart.scales.x;
          const yScale = chart.scales.y;
          const x = xScale.getPixelForValue(overall_fail * 100);
          const ctx = chart.ctx;
          ctx.save();
          ctx.strokeStyle = "rgba(231,76,60,0.7)";
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, yScale.top);
          ctx.lineTo(x, yScale.bottom);
          ctx.stroke();
          ctx.fillStyle = "rgba(231,76,60,0.9)";
          ctx.font = "10px sans-serif";
          ctx.fillText(`全體基準 ${(overall_fail*100).toFixed(1)}%`, x + 4, yScale.top + 10);
          ctx.restore();
        },
      }],
    });
  }

  // ── ④ R×S 5×5 熱力圖 ──────────────────────────────────────
  // 色階：以 fail_rate_final 相對於全體基準 (overall.fail_rate_final) 的
  // 倍數決定顏色深淺；low_sample / S5（序列不足）格子顯示灰色斜線紋理。
  // 點擊格子展開詳細統計（n / mean±SD / fail_rate / z）。
  const R_CODES = ["R1","R2","R3","R4","R5"];
  const S_CODES = ["S1","S2","S3","S4","S5"];

  function _cellColor(fail_rate, overall_fail) {
    if (fail_rate == null) return "transparent";
    const ratio = overall_fail > 0 ? fail_rate / overall_fail : 1;
    // ratio: <0.7 綠 / 0.7-1.3 黃 / >1.3 橘 / >1.6 紅
    if (ratio < 0.7)  return "rgba(46,204,113,0.55)";   // 低於基準70% → 綠
    if (ratio < 1.0)  return "rgba(46,204,113,0.25)";   // 略低於基準 → 淺綠
    if (ratio < 1.3)  return "rgba(241,196,15,0.35)";   // 略高於基準 → 黃
    if (ratio < 1.6)  return "rgba(230,126,34,0.45)";   // 中高 → 橘
    return "rgba(231,76,60,0.55)";                       // 高 → 紅
  }

  function _renderHeatmap() {
    const wrap = document.getElementById("crossHeatmapGrid");
    const detail = document.getElementById("crossHeatmapDetail");
    if (!wrap) return;

    const matrix = _crossData.cross_matrix || {};
    const overall_fail = _crossData.overall.fail_rate_final;

    // 表頭（S群）
    let html = `<div class="cross-heatmap-grid">`;
    html += `<div class="cross-heatmap-cell cross-heatmap-corner"></div>`;
    S_CODES.forEach(sg => {
      html += `<div class="cross-heatmap-cell cross-heatmap-header">
                 <div style="font-weight:700;color:${COLORS[sg]}">${sg}</div>
                 <div style="font-size:0.65rem;color:var(--text-dim,#888)">${S_NAMES[sg]}</div>
               </div>`;
    });

    // 各列（R群）
    R_CODES.forEach(rg => {
      html += `<div class="cross-heatmap-cell cross-heatmap-header">
                 <div style="font-weight:700;color:${COLORS[rg]}">${rg}</div>
                 <div style="font-size:0.65rem;color:var(--text-dim,#888)">${CLUSTER_NAMES[rg]}</div>
               </div>`;

      S_CODES.forEach(sg => {
        const cell = (matrix[rg] && matrix[rg][sg]) || {};
        const isS5 = sg === "S5";
        const isLowSample = !!cell.low_sample || (cell.n ?? 0) < LOW_SAMPLE_MIN;
        const hasStats = cell.fail_rate_final != null && !isLowSample && !isS5;

        if (!hasStats) {
          // 灰色斜線紋理：樣本不足 或 S5（序列不足）
          const reason = isS5 ? "序列不足" : "樣本不足";
          html += `<div class="cross-heatmap-cell cross-heatmap-empty"
                        title="${rg}×${sg}：${reason}（n=${cell.n ?? 0}）"
                        data-r="${rg}" data-s="${sg}">
                     <div style="font-size:0.65rem;color:var(--text-dim,#888)">n=${cell.n ?? 0}</div>
                     <div style="font-size:0.6rem;color:var(--text-dim,#888)">${reason}</div>
                   </div>`;
        } else {
          const bg = _cellColor(cell.fail_rate_final, overall_fail);
          html += `<div class="cross-heatmap-cell cross-heatmap-data" data-r="${rg}" data-s="${sg}"
                        style="background:${bg}" role="button" tabindex="0"
                        title="點擊查看 ${rg}×${sg} 詳細統計">
                     <div style="font-weight:700;font-size:0.85rem">${_pct(cell.fail_rate_final)}</div>
                     <div style="font-size:0.65rem;color:var(--text-dim,#888)">n=${cell.n}</div>
                   </div>`;
        }
      });
    });
    html += `</div>`;

    // 圖例
    html += `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;font-size:0.7rem;color:var(--text-dim,#888)">
        <span>不及格率（相對全體基準 ${_pct(overall_fail)}）：</span>
        <span><span class="cross-legend-swatch" style="background:rgba(46,204,113,0.55)"></span>&lt;70%</span>
        <span><span class="cross-legend-swatch" style="background:rgba(46,204,113,0.25)"></span>70–100%</span>
        <span><span class="cross-legend-swatch" style="background:rgba(241,196,15,0.35)"></span>100–130%</span>
        <span><span class="cross-legend-swatch" style="background:rgba(230,126,34,0.45)"></span>130–160%</span>
        <span><span class="cross-legend-swatch" style="background:rgba(231,76,60,0.55)"></span>&gt;160%</span>
        <span><span class="cross-legend-swatch cross-legend-hatch"></span>樣本不足 / 序列不足</span>
      </div>
    `;

    wrap.innerHTML = html;
    _injectStyleOnce("__cross-style-heatmap", _STYLES.heatmap);

    // 點擊事件：展開詳細統計
    wrap.querySelectorAll(".cross-heatmap-data").forEach(el => {
      el.addEventListener("click", () => _showHeatmapDetail(el.dataset.r, el.dataset.s));
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          _showHeatmapDetail(el.dataset.r, el.dataset.s);
        }
      });
    });

    if (detail) detail.innerHTML = `<p style="font-size:0.78rem;color:var(--text-dim,#888);padding:6px 4px">
      點擊上方格子查看該 R×S 組合的詳細統計。</p>`;
  }

  function _severityTextColor(fail_rate, overall_fail) {
    if (fail_rate == null || overall_fail <= 0) return "var(--text,#eee)";
    const ratio = fail_rate / overall_fail;
    if (ratio < 0.7) return "#2ecc71";
    if (ratio < 1.3) return "#f1c40f";
    if (ratio < 1.6) return "#e67e22";
    return "#e74c3c";
  }

  function _showHeatmapDetail(rg, sg) {
    const detail = document.getElementById("crossHeatmapDetail");
    if (!detail) return;

    const cell = ((_crossData.cross_matrix || {})[rg] || {})[sg] || {};
    const overall = _crossData.overall;

    const zNote = (z) => {
      if (z == null) return "";
      const abs = Math.abs(z);
      const sig = abs >= 2.58 ? "p&lt;0.01 ***" : abs >= 1.96 ? "p&lt;0.05 *" : "未達顯著";
      const dir = z > 0 ? "高於" : "低於";
      return `（z=${z.toFixed(2)}，${dir}全體平均，${sig}）`;
    };

    detail.innerHTML = `
      <div style="padding:10px 12px;border-radius:6px;background:var(--surface2,#1c2030);
                  border:1px solid var(--border2,#2a2f45);font-size:0.82rem;line-height:1.7">
        <div style="font-weight:700;margin-bottom:6px">
          <span style="color:${COLORS[rg]}">${rg} ${CLUSTER_NAMES[rg]}</span>
          ×
          <span style="color:${COLORS[sg]}">${sg} ${S_NAMES[sg]}</span>
        </div>
        <div>樣本數：<strong>${cell.n ?? 0}</strong></div>
        ${cell.final_mean != null ? `<div>期末成績：<strong>${cell.final_mean.toFixed(1)} ± ${cell.final_sd?.toFixed(1) ?? '—'}</strong></div>` : ''}
        ${cell.fail_rate_final != null ? `
          <div>期末不及格率：<strong style="color:${_severityTextColor(cell.fail_rate_final, overall.fail_rate_final)}">
            ${_pct(cell.fail_rate_final)}</strong>
            （全體基準 ${_pct(overall.fail_rate_final)}）
            ${zNote(cell.z_vs_overall_final)}
          </div>` : ''}
        ${cell.note ? `<div style="color:var(--text-dim,#888)">ℹ️ ${_safeText(cell.note)}</div>` : ''}
      </div>
    `;
  }

  // ── ⑤ 軌跡分型 & 學習方法說明卡（可收折）────────────────────
  function _renderLegendCards() {
    _injectStyleOnce("__cross-style-legend", _STYLES.legend);

    const trajWrap = document.getElementById("crossTrajLegend");
    if (trajWrap && !trajWrap.dataset.ready) {
      trajWrap.dataset.ready = "1";
      trajWrap.innerHTML = `<summary class="cross-legend-summary">
          <span class="cross-legend-summary-icon">▶</span>
          分析框架說明 — 期中→期末軌跡分型（SS / FS / SF / FF）
        </summary>
        <div class="cross-legend-body">
          <table class="cross-legend-table">
            <thead><tr><th>代碼</th><th>名稱</th><th>行為特徵</th><th>量化判斷條件</th><th>教學建議</th></tr></thead>
            <tbody>
              <tr>
                <td class="cross-legend-code" style="color:#2ecc71">SS</td>
                <td>穩定及格</td>
                <td>期中、期末皆及格，學習軌跡穩定</td>
                <td>期中成績 ≥ 60 且 期末成績 ≥ 60</td>
                <td>正向強化，鼓勵維持節奏與自主學習習慣</td>
              </tr>
              <tr>
                <td class="cross-legend-code" style="color:#3498db">FS</td>
                <td>自救成功</td>
                <td>期中不及格但期末翻轉，屬高韌性學習者</td>
                <td>期中成績 &lt; 60 且 期末成績 ≥ 60</td>
                <td>分析翻轉策略，複製成功模式，強化學生信心</td>
              </tr>
              <tr>
                <td class="cross-legend-code" style="color:#e67e22">SF</td>
                <td>成績滑落</td>
                <td>期中及格但期末退步，後期投入下降</td>
                <td>期中成績 ≥ 60 且 期末成績 &lt; 60</td>
                <td>關注後半學期出勤與作答頻率，主動介入追蹤</td>
              </tr>
              <tr>
                <td class="cross-legend-code" style="color:#e74c3c">FF</td>
                <td>持續不及格</td>
                <td>期中、期末皆不及格，高風險長期低效</td>
                <td>期中成績 &lt; 60 且 期末成績 &lt; 60</td>
                <td>優先介入，轉介學習支援資源，評估學習障礙</td>
              </tr>
            </tbody>
          </table>
          <p class="cross-legend-note">
            ※ 基準：期中／期末成績及格線均為 60 分；S5（序列不足）與低樣本群（n &lt; 5）不計入軌跡分布。
          </p>
        </div>
      `;
    }

    const appWrap = document.getElementById("crossApproachLegend");
    if (appWrap && !appWrap.dataset.ready) {
      appWrap.dataset.ready = "1";
      appWrap.innerHTML = `<summary class="cross-legend-summary">
          <span class="cross-legend-summary-icon">▶</span>
          分析框架說明 — 學習方法三型分布（DEEP / SURFACE / MODERATE）
        </summary>
        <div class="cross-legend-body">
          <table class="cross-legend-table">
            <thead><tr><th>代碼</th><th>名稱</th><th>行為特徵</th><th>量化判斷條件</th><th>教學建議</th></tr></thead>
            <tbody>
              <tr>
                <td class="cross-legend-code" style="color:#2ecc71">DEEP</td>
                <td>深層學習</td>
                <td>主動切換資源，影音與閱讀兼用，序列多元</td>
                <td>QMI ≥ 0.6 且 score_delta &lt; 0.2（首次高正確率、進步空間小）</td>
                <td>引導自主探究，鼓勵跨資源整合與知識建構</td>
              </tr>
              <tr>
                <td class="cross-legend-code" style="color:#e74c3c">SURFACE</td>
                <td>表層學習</td>
                <td>首次作答正確率低，反覆練習後才達標，依賴重複刷題</td>
                <td>score_delta ≥ 0.3（首次低、多次練習才通過，依賴題海戰術）</td>
                <td>強化學習計畫與策略指導，提供多元資源引導</td>
              </tr>
              <tr>
                <td class="cross-legend-code" style="color:#f1c40f">MODERATE</td>
                <td>中間型</td>
                <td>介於深層與表層之間，行為模式尚未穩定</td>
                <td>QMI 0.4–0.6 或 score_delta 0.2–0.3（介於深層與表層之間）</td>
                <td>引導提升學習深度，追蹤是否向深層或表層偏移</td>
              </tr>
            </tbody>
          </table>
          <p class="cross-legend-note">
            ※ QMI（題庫精熟指數）＝ 首次作答正確率×0.55 + 最終作答正確率×0.45 − 分數成長幅度×0.3；被動指數 ＝ 集中刷題率×0.70 + 考前衝刺強度×0.30。
            各群閾值依全體中位數動態計算，非固定常數。
          </p>
        </div>
      `;
    }
  }

  // ── ⑥ 軌跡分型堆疊圖（V-T：SS/FS/SF/FF）──────────────────
  // 依 R群/S群分組，顯示各群組「期中→期末」四種軌跡的比例分布。
  // R2/S5（no_baseline，無 trajectory 資料）顯示為單一灰色佔位列。
  const TRAJ_KEYS  = ["SS", "FS", "SF", "FF"];
  const TRAJ_NAMES = { SS: "穩定及格", FS: "自救成功", SF: "成績滑落", FF: "持續不及格" };
  const TRAJ_COLORS = { SS: "#2ecc71", FS: "#3498db", SF: "#e67e22", FF: "#e74c3c" };

  const APPROACH_KEYS  = ["DEEP", "SURFACE", "MODERATE"];
  const APPROACH_NAMES = { DEEP: "深層學習", SURFACE: "表層學習", MODERATE: "中間型" };
  const APPROACH_COLORS = { DEEP: "#2ecc71", SURFACE: "#e74c3c", MODERATE: "#f1c40f" };

  /**
   * 共用的分布類堆疊圖建構器（V-T / V-A）。
   * @param {string}   canvasId
   * @param {function} getChart     () => Chart|null  取得外部模組變數
   * @param {function} setChart     (Chart) => void   回寫外部模組變數
   * @param {string[]} keys         例如 TRAJ_KEYS 或 APPROACH_KEYS
   * @param {object}   names        代碼 → 顯示名稱
   * @param {object}   colors       代碼 → 顏色
   * @param {string}   distField    'trajectory' 或 'approach'
   * @param {string}   legendTitle
   */
  // ARCH-2 FIX: 原版使用 getter/setter wrapper 物件（反模式），
  // 改為 getChart/setChart callback，語意清晰且無 closure 陷阱。
  function _renderDistributionStackedChart(canvasId, getChart, setChart, keys, names, colors, distField, legendTitle) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === "undefined") return;

    const rStats = _crossData.by_r_cluster || {};
    const sStats = _crossData.by_s_cluster || {};

    const labels = [];
    const rows = []; // 每列：{ dist: {key:ratio,...} | null, n, lowSample }

    function pushGroup(code, statMap, nameMap) {
      const s = statMap[code];
      if (!s) return;
      labels.push(`${code} ${nameMap[code]}`);
      if (s.low_sample || s.no_baseline || !s[distField]) {
        rows.push({ dist: null, n: s.n ?? 0, lowSample: true });
      } else {
        rows.push({ dist: s[distField], n: s.n, lowSample: false });
      }
    }

    for (const code of ["R1","R2","R3","R4","R5"]) pushGroup(code, rStats, CLUSTER_NAMES);
    labels.push(""); rows.push({ dist: null, n: null, separator: true });
    for (const code of ["S1","S2","S3","S4","S5"]) pushGroup(code, sStats, S_NAMES);

    const datasets = keys.map(key => ({
      label: `${key} ${names[key]}`,
      data: rows.map(r => {
        if (r.separator) return null;
        if (r.dist == null) return 0;
        return (r.dist[key] ?? 0) * 100;
      }),
      backgroundColor: colors[key],
      stack: "dist",
    }));

    // 樣本不足/分隔列：疊加一個灰色全幅佔位 dataset，避免空白誤判為 0%
    datasets.push({
      label: "樣本不足／無資料",
      data: rows.map(r => (r.lowSample ? 100 : null)),
      backgroundColor: "rgba(150,150,150,0.25)",
      stack: "dist",
    });

    const existing = getChart();
    if (existing) existing.destroy();
    setChart(new Chart(canvas, {
      type: "bar",
      data: { labels, datasets },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 10 } } },
          tooltip: {
            callbacks: {
              title: (items) => items[0]?.label || "",
              label: (ctx) => {
                const row = rows[ctx.dataIndex];
                if (!row || row.separator) return "";
                if (row.lowSample) {
                  if (ctx.dataset.label !== "樣本不足／無資料") return "";
                  return `樣本不足（n=${row.n}），無分布資料`;
                }
                if (ctx.dataset.label === "樣本不足／無資料") return "";
                const v = ctx.parsed.x;
                return `${ctx.dataset.label}：${v.toFixed(1)}%（n≈${Math.round(row.n * v / 100)}）`;
              },
            },
          },
        },
        scales: {
          x: {
            stacked: true,
            min: 0, max: 100,
            title: { display: true, text: `${legendTitle} (%)` },
          },
          y: { stacked: true },
        },
      },
    }));
  }

  function _renderTrajectoryChart() {
    _renderDistributionStackedChart(
      "crossTrajectoryChart",
      () => _trajChart,
      (c) => { _trajChart = c; },
      TRAJ_KEYS, TRAJ_NAMES, TRAJ_COLORS, "trajectory", "期中→期末軌跡分布"
    );
  }

  function _renderApproachChart() {
    _renderDistributionStackedChart(
      "crossApproachChart",
      () => _approachChart,
      (c) => { _approachChart = c; },
      APPROACH_KEYS, APPROACH_NAMES, APPROACH_COLORS, "approach", "學習方法分布"
    );
  }

  return { init, resetFilters };
})();
