/**
 * tab-behavior-warning.js  —  v1.0
 *
 * 提前預警 sub-tab（第6個，掛載於 sub-cross 之後）。
 *
 * 設計原則：
 *   - 目標學期不鎖死。透過 BehaviorLoader.getWarningTargetSemester()
 *     動態取得「目前尚未有期末成績的最新學期」（來自 cross_analysis.json
 *     的 meta.incomplete_semesters_excluded）。
 *   - 若目前沒有任何「未完成學期」（所有學期皆已有期末成績），
 *     顯示「目前無提前預警目標」，不視為錯誤。
 *
 * 內容：
 *   ① 摘要橫幅：HIGH/MEDIUM/LOW 人數 + 歷史參考不及格率
 *   ② 風險等級篩選（全部/HIGH/MEDIUM/LOW）
 *   ③ 學生清單（masked_id, R群, S群, learning_approach, qmi, bas, triggered_rules）
 *   ④ CSV 匯出
 *
 * 資料來源：BehaviorLoader.loadWarningForCurrentTarget()
 *           → { semester, data } 或 null
 */

const BehaviorWarningTab = (() => {

  let _warningData = null;
  let _semester = null;
  let _activeFilter = "ALL"; // ALL | HIGH | MEDIUM | LOW

  const CLUSTER_NAMES = { R1:"影音輔導型", R2:"彈性聽覺型", R3:"平均使用型", R4:"題庫刷題型", R5:"被動低參與型" };
  const S_NAMES       = { S1:"高主動切換型", S2:"均衡切換型", S3:"教材持續型", S4:"被動序列型", S5:"序列不足" };
  const APPROACH_NAMES = { DEEP:"深層學習", SURFACE:"表層學習", MODERATE:"中間型" };

  const LEVEL_META = {
    HIGH:   { label: "高風險",   color: "#e74c3c", bg: "rgba(231,76,60,0.10)" },
    MEDIUM: { label: "中度風險", color: "#e67e22", bg: "rgba(230,126,34,0.10)" },
    LOW:    { label: "低風險",   color: "#2ecc71", bg: "rgba(46,204,113,0.08)" },
  };

  function _safeText(s) {
    return typeof escapeHtml === "function" ? escapeHtml(String(s)) : String(s);
  }

  function _pct(x) {
    return (x == null) ? "—" : (x * 100).toFixed(1) + "%";
  }

  // ── 初始化 ──────────────────────────────────────────────
  async function init() {
    let result;
    try {
      result = await BehaviorLoader.loadWarningForCurrentTarget();
    } catch (e) {
      console.error("[BehaviorWarningTab] load error:", e);
      _renderEmpty("warning_*.json 載入失敗，請確認 ETL 是否已執行 12_early_warning.py。");
      throw e;
    }

    if (!result) {
      _renderNoTarget();
      return;
    }

    _semester = result.semester;
    _warningData = result.data;

    if (!_warningData || !_warningData.summary) {
      _renderEmpty(`warning_${_semester}.json 結構異常，缺少 summary 欄位。`);
      return;
    }

    _activeFilter = "ALL";
    _renderAll();
  }

  function resetFilters() {
    // WARN-2 FIX: 未載入時不設定狀態（原 _activeFilter = "ALL" 無後續效果）
    if (!_warningData) return;
    _activeFilter = "ALL";
    _renderAll();
  }

  function _renderEmpty(msg) {
    const el = document.getElementById("sub-warning");
    if (!el) return;
    el.innerHTML = `<p style="color:#c0392b;font-size:0.85rem;padding:12px">⚠️ ${_safeText(msg)}</p>`;
  }

  function _toggleMainCards(show) {
    ["warningSummaryBanner", "warningFilterBar", "warningStudentList", "warningExportBtn"]
      .forEach(id => {
        const el = document.getElementById(id);
        const card = el?.closest(".chart-card");
        // WARN-3: 若 DOM 缺少 .chart-card 祖先，visibility toggle 靜默失效
        if (el && !card) console.warn(`[BehaviorWarningTab] #${id} 找不到 .chart-card 祖先，_toggleMainCards 無效`);
        if (card) card.style.display = show ? "" : "none";
      });
  }

  function _renderNoTarget() {
    _toggleMainCards(false);
    const wrap = document.getElementById("warningContent");
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="text-align:center;padding:32px 16px;color:var(--text-dim,#888);font-size:0.85rem">
        <div style="font-size:1.6rem;margin-bottom:8px">✅</div>
        目前所有學期皆已有期末成績，沒有需要提前預警的目標學期。
      </div>`;
  }

  function _renderAll() {
    _toggleMainCards(true);
    document.getElementById("warningContent").innerHTML = "";
    _renderSummaryBanner();
    _renderFilterBar();
    _renderStudentList();
    _renderExportButton();
  }

  // ── ① 摘要橫幅 ──────────────────────────────────────────
  function _renderSummaryBanner() {
    const wrap = document.getElementById("warningSummaryBanner");
    if (!wrap) return;

    const m = _warningData.meta;
    const s = _warningData.summary;

    const cards = ["HIGH", "MEDIUM", "LOW"].map(level => {
      const meta = LEVEL_META[level];
      const v = s[level];
      return `
        <div class="warning-stat-box" style="border-left:3px solid ${meta.color}">
          <div class="warning-stat-label" style="color:${meta.color}">${meta.label}</div>
          <div class="warning-stat-value">${v.count} 人</div>
          <div class="warning-stat-sub">歷史參考不及格率 ${_pct(v.historical_fail_rate_ref)}</div>
        </div>`;
    }).join("");

    // 防線3：驗證結果區塊（schema 1.1 才有 validation_date key）
    let validationHtml = "";
    if ("validation_date" in (m ?? {})) {
      const cal  = m.validation_summary?.calibration ?? {};
      const auc  = m.validation_summary?.auc;
      const date = new Date(m.validation_date).toLocaleDateString("zh-TW");
      const calRows = ["HIGH", "MEDIUM", "LOW"].map(lvl => {
        const c = cal[lvl] ?? {};
        const sign = (c.calibration_error ?? 0) >= 0 ? "+" : "";
        const errPp = c.calibration_error != null ? (c.calibration_error * 100).toFixed(1) : "—";
        const errClass = c.calibration_error != null && Math.abs(c.calibration_error) > 0.05
          ? "color:#e74c3c;font-weight:600" : "color:#2ecc71";
        return `<tr>
          <td style="padding:3px 8px">${lvl}</td>
          <td style="padding:3px 8px">${c.predicted_fail_rate != null ? (c.predicted_fail_rate * 100).toFixed(1) + "%" : "—"}</td>
          <td style="padding:3px 8px">${c.actual_fail_rate    != null ? (c.actual_fail_rate    * 100).toFixed(1) + "%" : "—"}</td>
          <td style="padding:3px 8px;${errClass}">${sign}${errPp}pp</td>
        </tr>`;
      }).join("");
      const aucHtml = auc != null
        ? `<div style="margin-top:6px;font-size:0.72rem;color:var(--text-dim,#888)">模型區辨力 AUC = ${auc.toFixed(3)}</div>`
        : `<div style="margin-top:6px;font-size:0.72rem;color:var(--text-dim,#888)">AUC：樣本不足，無法計算</div>`;
      validationHtml = `
        <div style="margin-top:12px;padding:10px 12px;border-radius:6px;
                    background:rgba(46,204,113,0.06);border:1px solid rgba(46,204,113,0.25)">
          <div style="font-size:0.75rem;font-weight:600;color:#2ecc71;margin-bottom:6px">
            ✅ 前瞻性驗證結果（${_safeText(date)}，${_safeText(_semester)}學期期末成績）
          </div>
          <table style="width:100%;font-size:0.72rem;border-collapse:collapse">
            <thead><tr style="color:var(--text-dim,#888)">
              <th style="padding:3px 8px;text-align:left;font-weight:600">風險等級</th>
              <th style="padding:3px 8px;text-align:left;font-weight:600">預測不及格率</th>
              <th style="padding:3px 8px;text-align:left;font-weight:600">實際不及格率</th>
              <th style="padding:3px 8px;text-align:left;font-weight:600">校準誤差</th>
            </tr></thead>
            <tbody>${calRows}</tbody>
          </table>
          ${aucHtml}
        </div>`;
    }

    wrap.innerHTML = `
      <div style="font-size:0.82rem;line-height:1.7">
        <div style="margin-bottom:10px;padding:8px 10px;border-radius:6px;
                    background:rgba(100,160,255,0.07);border:1px solid rgba(100,160,255,0.2)">
          🔮 <strong>目標學期：${_safeText(_semester)}</strong>　
          總人數 ${m.total_students}　|　
          ${_safeText(m.data_cutoff || '')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:10px">
          ${cards}
        </div>
        <div style="font-size:0.72rem;color:var(--text-dim,#888)">
          主規則：${_safeText(m.primary_rule || '')}　|　
          參考資料：${_safeText(m.reference_data || '')}
        </div>
        ${validationHtml}
      </div>
      <style>
        .warning-stat-box{padding:10px 12px;border-radius:6px;background:var(--surface2,#1c2030)}
        .warning-stat-label{font-size:0.75rem;font-weight:600;margin-bottom:4px}
        .warning-stat-value{font-size:1.15rem;font-weight:700;color:var(--text,#eee)}
        .warning-stat-sub{font-size:0.68rem;color:var(--text-dim,#888);margin-top:2px}
      </style>
    `;
  }

  // ── ② 風險等級篩選 ───────────────────────────────────────
  function _renderFilterBar() {
    const wrap = document.getElementById("warningFilterBar");
    if (!wrap) return;

    const s = _warningData.summary;
    const total = s.HIGH.count + s.MEDIUM.count + s.LOW.count;

    const options = [
      { key: "ALL", label: `全部 (${total})`, color: "var(--accent,#3498db)" },
      { key: "HIGH", label: `高風險 (${s.HIGH.count})`, color: LEVEL_META.HIGH.color },
      { key: "MEDIUM", label: `中度風險 (${s.MEDIUM.count})`, color: LEVEL_META.MEDIUM.color },
      { key: "LOW", label: `低風險 (${s.LOW.count})`, color: LEVEL_META.LOW.color },
    ];

    wrap.innerHTML = options.map(o => {
      const active = o.key === _activeFilter;
      return `<button type="button" class="warning-filter-btn" data-level="${o.key}"
                style="padding:4px 12px;border-radius:16px;border:1px solid ${o.color};
                       background:${active ? o.color : 'transparent'};
                       color:${active ? '#fff' : o.color};
                       cursor:pointer;font-size:0.78rem;margin-right:6px;margin-bottom:6px">
                ${o.label}
              </button>`;
    }).join("");

    wrap.querySelectorAll(".warning-filter-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        _activeFilter = btn.dataset.level;
        _renderFilterBar();
        _renderStudentList();
      });
    });
  }

  // ── ③ 學生清單 ───────────────────────────────────────────
  function _renderStudentList() {
    const wrap = document.getElementById("warningStudentList");
    if (!wrap) return;

    let students = _warningData.students || [];
    if (_activeFilter !== "ALL") {
      students = students.filter(s => s.risk_level === _activeFilter);
    }

    if (students.length === 0) {
      wrap.innerHTML = `<p style="font-size:0.8rem;color:var(--text-dim,#888);padding:8px">此篩選條件下無學生。</p>`;
      return;
    }

    const hasValidation = "validation_date" in (_warningData?.meta ?? {});
    const rows = students.map(s => {
      const meta = LEVEL_META[s.risk_level] || {};
      const rules = (s.triggered_rules || []).map(r =>
        `<span class="warning-rule-badge">${_safeText(r)}</span>`
      ).join("");

      const finalScoreCell = hasValidation
        ? `<td>${s.actual_final_score !== undefined ? s.actual_final_score.toFixed(1) : "—"}</td>`
        : "";
      const outcomeCell = hasValidation
        ? `<td>${
            s.actual_outcome === "FAIL" ? '<span style="color:#e74c3c;font-weight:600">不及格</span>' :
            s.actual_outcome === "PASS" ? '<span style="color:#2ecc71">及格</span>' :
            "—"
          }</td>`
        : "";

      return `
        <tr style="border-left:3px solid ${meta.color || '#888'}">
          <td>${_safeText(s.masked_id)}</td>
          <td><span class="warning-level-pill" style="background:${meta.bg};color:${meta.color}">
                ${meta.label}</span></td>
          <td>${_safeText(s.r_cluster)} ${_safeText(CLUSTER_NAMES[s.r_cluster] || '')}</td>
          <td>${_safeText(s.s_cluster)} ${_safeText(S_NAMES[s.s_cluster] || '')}</td>
          <td>${_safeText(APPROACH_NAMES[s.learning_approach] || s.learning_approach || '—')}</td>
          <td>${s.midterm_score != null ? s.midterm_score.toFixed(1) : '—'}
              ${s.midterm_status === 'FAIL' ? '<span style="color:#e74c3c">(不及格)</span>' : ''}</td>
          <td>${s.qmi != null ? s.qmi.toFixed(3) : '—'}</td>
          <td>${s.bas_score != null ? s.bas_score.toFixed(2) : '—'}</td>
          <td>${rules}</td>
          ${finalScoreCell}${outcomeCell}
        </tr>`;
    }).join("");

    const validationHeaders = hasValidation
        ? `<th>期末成績</th><th>實際結果</th>`
        : "";
    wrap.innerHTML = `
      <div style="overflow-x:auto">
        <table class="warning-table">
          <thead>
            <tr>
              <th>學號</th><th>風險等級</th><th>R群</th><th>S群</th>
              <th>學習方法</th><th>期中成績</th><th>QMI</th><th>BAS</th><th>觸發規則</th>
              ${validationHeaders}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <style>
        .warning-table{width:100%;border-collapse:collapse;font-size:0.76rem}
        .warning-table th{text-align:left;padding:6px 8px;border-bottom:2px solid var(--border2,#2a2f45);
                           color:var(--text-dim,#888);font-weight:600;white-space:nowrap}
        .warning-table td{padding:5px 8px;border-bottom:1px solid var(--border2,#2a2f45);white-space:nowrap}
        .warning-level-pill{padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:600}
        .warning-rule-badge{display:inline-block;padding:1px 6px;margin:1px;border-radius:4px;
                             background:rgba(150,150,150,0.15);font-size:0.68rem;color:var(--text-dim,#888)}
      </style>
    `;
  }

  // ── ④ CSV 匯出 ───────────────────────────────────────────
  function _renderExportButton() {
    const wrap = document.getElementById("warningExportBtn");
    if (!wrap) return;

    wrap.innerHTML = `
      <button type="button" id="warningCsvBtn"
              style="padding:6px 14px;border-radius:6px;border:1px solid var(--accent,#3498db);
                     background:transparent;color:var(--accent,#3498db);cursor:pointer;font-size:0.8rem">
        ⬇️ 匯出目前篩選結果為 CSV
      </button>`;

    const btn = document.getElementById("warningCsvBtn");
    if (btn) btn.addEventListener("click", _exportCsv);
  }

  function _exportCsv() {
    let students = _warningData.students || [];
    if (_activeFilter !== "ALL") {
      students = students.filter(s => s.risk_level === _activeFilter);
    }

    const hasValidation = "validation_date" in (_warningData?.meta ?? {});
    const headers = [
      "masked_id","risk_level","r_cluster","s_cluster",
      "learning_approach","midterm_score","midterm_status",
      "qmi","bas_score","triggered_rules",
      ...(hasValidation ? ["actual_final_score","actual_outcome"] : [])
    ];
    const lines = [headers.join(",")];

    students.forEach(s => {
      const row = [
        s.masked_id, s.risk_level, s.r_cluster, s.s_cluster,
        s.learning_approach, s.midterm_score ?? "", s.midterm_status ?? "",
        s.qmi ?? "", s.bas_score ?? "",
        `"${(s.triggered_rules || []).join("; ")}"`,
        ...(hasValidation ? [
          s.actual_final_score !== undefined ? s.actual_final_score : "",
          s.actual_outcome ?? "",
        ] : []),
      ];
      lines.push(row.join(","));
    });

    const csv = "\uFEFF" + lines.join("\n"); // BOM for Excel CJK
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `warning_${_semester}_${_activeFilter}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return { init, resetFilters };
})();
