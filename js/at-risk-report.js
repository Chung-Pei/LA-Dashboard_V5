// ══════════════════════════════════════════════════════════
// at-risk-report.js
// Phase 4：高風險報告管理器 (AtRiskReportManager)
// 對應規格書 §5.2–§6.2
// 依賴：main.js（escapeHtml、Chart 全域物件）
// ══════════════════════════════════════════════════════════

const AtRiskReportManager = (() => {
  let _initialized = false;
  let _data = null;
  let _currentSem = null;
  let _currentSemData = null;
  let _radarFilter = null;

  // ── 第4類紅旗：提前預警摘要（warning_*.json）────────────
  // 與 sub-warning（tab-behavior-warning.js）共用同一份資料來源，
  // 透過 BehaviorLoader.loadWarningForCurrentTarget() 取得「目前尚無
  // 期末成績的最新學期」之預警摘要。若該學期非當前選取學期，不顯示。
  let _warningData = null;
  let _warningSemester = null;

  // ── 第5類：XGBoost feature importance（cross_analysis.json）──
  // 重用既有 BehaviorLoader.load.crossAnalysis()（tab-behavior-cross.js
  // 已在用，有LRU快取），不新增 loader，避免修改 behavior-loader.js。
  let _featureImportance = [];

  // ── 內部工具 ────────────────────────────────────────────
  function _toFiniteNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function _normalizeCohortSummary(cs) {
    cs = cs || {};
    const passCount      = Math.max(0, Math.round(_toFiniteNumber(cs.pass_count)));
    const failCount      = Math.max(0, Math.round(_toFiniteNumber(cs.fail_count)));
    const gradedTotal    = passCount + failCount;
    const rawTotal       = Math.max(0, Math.round(_toFiniteNumber(cs.total_students, gradedTotal)));
    const explicitUnsettled = Math.max(0, Math.round(_toFiniteNumber(cs.unsettled_count)));
    const inferredUnsettled = Math.max(rawTotal - gradedTotal, 0);
    const unsettledCount = Math.max(explicitUnsettled, inferredUnsettled);
    const totalStudents  = Math.max(rawTotal, gradedTotal + unsettledCount);
    return {
      total_students:  totalStudents,
      pass_count:      passCount,
      fail_count:      failCount,
      graded_total:    gradedTotal,
      unsettled_count: unsettledCount,
      fail_rate_pct:   gradedTotal > 0
        ? +(failCount / gradedTotal * 100).toFixed(1)
        : null,
    };
  }

  // ── §5.2 班級概況卡片 ────────────────────────────────────
  function renderCohortSummary(cs) {
    const el = document.getElementById('rCohortSummary');
    if (!el) return;
    const safe = _normalizeCohortSummary(cs);
    const hasUnsettled = safe.unsettled_count > 0;
    const cards = [
      { label: '全體學生',   value: safe.total_students,  unit: '人', color: 'var(--accent)',  filter: null },
      ...(hasUnsettled
        ? [{ label: '未結算人數', value: safe.unsettled_count, unit: '人', color: '#8e44ad', filter: null }]
        : []),
      { label: '不及格人數', value: safe.fail_count,       unit: '人', color: '#e74c3c',        filter: safe.fail_count > 0 ? 'fail' : null },
      { label: '及格人數',   value: safe.pass_count,       unit: '人', color: '#27ae60',        filter: safe.pass_count > 0 ? 'pass' : null },
      { label: '不及格率',   value: safe.fail_rate_pct,    unit: '%',  color: '#e67e22',        filter: null, empty: safe.fail_rate_pct == null },
    ];
    el.innerHTML = '';
    const frag = document.createDocumentFragment();
    cards.forEach(c => {
      const card = document.createElement('div');
      card.className = 'r-cohort-card' + (c.filter !== null ? ' r-cohort-card--clickable' : '');
      card.style.setProperty('--card-accent', c.color);
      if (c.filter !== null) {
        card.dataset.filter = c.filter;
        card.dataset.action  = 'atRiskFilterRadarCard';
        card.title           = '點擊聚焦雷達圖';
      }
      const displayValue = c.empty
        ? '–'
        : (typeof c.value === 'number' ? c.value.toLocaleString() : c.value);
      const displayUnit = c.empty ? '' : ` ${c.unit}`;

      const valDiv = document.createElement('div');
      valDiv.className = 'r-cohort-value';
      valDiv.textContent = displayValue;
      const unitSpan = document.createElement('span');
      unitSpan.className = 'r-cohort-unit';
      unitSpan.textContent = displayUnit;
      valDiv.appendChild(unitSpan);

      const labelDiv = document.createElement('div');
      labelDiv.className = 'r-cohort-label';
      labelDiv.textContent = c.label;

      card.appendChild(valDiv);
      card.appendChild(labelDiv);
      frag.appendChild(card);
    });
    el.appendChild(frag);
  }

  // ── §5.2-b 雷達圖卡片聚焦 ───────────────────────────────
  function filterRadar(mode) {
    const canvas   = document.getElementById('rRadarChart');
    const clearBtn = document.getElementById('rRadarClearBtn');
    const chart    = canvas ? Chart.getChart(canvas) : null;

    if (mode === _radarFilter) mode = null;
    _radarFilter = mode;

    if (chart) {
      chart.data.datasets.forEach((ds, i) => {
        const isPass = (i === 0);
        const active =
          mode === null ? true :
          mode === 'pass' ? isPass : !isPass;
        ds.borderColor          = active
          ? (isPass ? 'rgba(39,174,96,0.85)'  : 'rgba(231,76,60,0.85)')
          : (isPass ? 'rgba(39,174,96,0.15)'  : 'rgba(231,76,60,0.15)');
        ds.backgroundColor      = active
          ? (isPass ? 'rgba(39,174,96,0.15)'  : 'rgba(231,76,60,0.12)')
          : 'rgba(0,0,0,0.03)';
        ds.pointBackgroundColor = ds.borderColor;
        ds.pointBorderColor     = ds.borderColor;
      });
      chart.update('none');
    }

    if (clearBtn) clearBtn.style.setProperty('display', mode !== null ? '' : 'none');

    document.querySelectorAll('#rCohortSummary [data-filter]').forEach(el => {
      const f = el.dataset.filter;
      if (mode === null) {
        el.style.setProperty('opacity', '1');                        // CSP-V7-FIX
        el.style.setProperty('box-shadow', '');
      } else if (f === mode) {
        el.style.setProperty('opacity', '1');                        // CSP-V7-FIX
        el.style.setProperty('box-shadow', `0 0 0 2px ${f === 'pass' ? '#27ae60' : '#e74c3c'}`);
      } else {
        el.style.setProperty('opacity', '0.45');                     // CSP-V7-FIX
        el.style.setProperty('box-shadow', '');
      }
    });
  }

  // ── §5.1 學期篩選器（schema 3.0+） ──────────────────────
  function renderSemesterFilter(semesters, defaultSem) {
    const wrapper = document.getElementById('rSemesterFilter');
    const btns    = document.getElementById('rSemesterBtns');
    if (!wrapper || !btns || !semesters?.length) return;

    const _makeSemBtn = (sem, label) => {
      const btn = document.createElement('button');
      btn.className   = 'r-sem-btn';
      btn.dataset.sem    = sem;
      btn.dataset.action = 'atRiskSwitchSemester';
      btn.textContent    = label;
      return btn;
    };
    btns.innerHTML = '';
    btns.appendChild(_makeSemBtn('__all__', '全部'));
    semesters.forEach(sem => btns.appendChild(_makeSemBtn(sem, sem)));

    wrapper.style.setProperty('display', 'flex');
    _highlightSemBtn(defaultSem);
  }

  function _highlightSemBtn(sem) {
    document.querySelectorAll('#rSemesterBtns [data-sem]').forEach(btn => {
      const active = btn.dataset.sem === sem;
      btn.style.setProperty('background',   active ? 'var(--accent,#4a90d9)' : 'var(--card-bg,#fff)');
      btn.style.setProperty('color',        active ? '#fff' : 'var(--text,#333)');
      btn.style.setProperty('border-color', active ? 'var(--accent,#4a90d9)' : 'var(--border,#ccc)');
      btn.style.setProperty('font-weight',  active ? '600' : '400');
      });
  }

  // ── 學期切換 ────────────────────────────────────────────
  function switchSemester(sem) {
    _radarFilter = null;
    _highlightSemBtn(sem);

    let semData;
    if (sem === '__all__') {
      semData = _data.all_semesters;
      if (!semData) return;
      _currentSem     = '__all__';
      _currentSemData = semData;
    } else {
      if (!_data?.by_semester?.[sem]) return;
      _currentSem     = sem;
      _currentSemData = _data.by_semester[sem];
      semData         = _currentSemData;
    }

    try {
      renderCohortSummary(semData.cohort_summary);
      renderRadarChart(semData.metrics_comparison);
      renderTemporalChart(semData.temporal_decay);
      renderRedFlags(semData.behavioral_markers, semData.temporal_decay);
      renderPrescriptions(semData.prescriptive_summary);
      renderTopRiskFactors(_featureImportance);
    } catch (e) {
      console.error('[AtRiskReportManager] 學期切換渲染失敗：', sem, e);
    }

    const clearBtn = document.getElementById('rRadarClearBtn');
    if (clearBtn) clearBtn.style.setProperty('display', 'none');
    document.querySelectorAll('#rCohortSummary [data-filter]').forEach(el => {
      el.style.setProperty('opacity', '1'); el.style.setProperty('box-shadow', ''); // CSP-V13-FIX
    });
  }

  // ── §5.3 六維度雷達圖 ────────────────────────────────────
  const RADAR_LABELS = [
    'TXT 教材完成率', 'SUP 解鎖教材', 'TUT 輔導資源',
    '考前學習強度', '學習穩定性', 'AUD 音頻時數',
  ];
  const RADAR_KEYS = [
    'text_material_completion', 'supplementary_completion', 'tutoring_resource_rate',
    'pre_exam_intensity', 'learning_stability', 'audio_material_hours',
  ];

  // 而瀏覽器原生 Canvas API 並不會解析 CSS var()（var() 僅在 CSS cascade 中生效），
  // 因此「色碼必須先用 getComputedStyle 解析成實際色值字串」才能正確套用主題色。
  function _resolveThemeColors() {
    const cs = getComputedStyle(document.body);
    const isLight = document.body.classList.contains('light');
    return {
      text:    cs.getPropertyValue('--text').trim()     || (isLight ? '#1a1d2e' : '#dde3f5'),
      textDim: cs.getPropertyValue('--text-dim').trim() || '#6b748f',
      border:  cs.getPropertyValue('--border').trim()   || (isLight ? '#c8cce0' : '#2a2f45'),
    };
  }

  function renderRadarChart(mc) {
    const canvas = document.getElementById('rRadarChart');
    if (!canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    mc = mc || {};

    const passVals = RADAR_KEYS.map(k => mc[k]?.pass_median_normalized ?? 0);
    const failVals = RADAR_KEYS.map(k => mc[k]?.fail_median_normalized ?? 0);

    const { text: clrText, textDim: clrTextDim, border: clrBorder } = _resolveThemeColors();

    new Chart(canvas, {
      type: 'radar',
      data: {
        labels: RADAR_LABELS,
        datasets: [
          {
            label: '及格組',
            data: passVals,
            backgroundColor:    'rgba(39,174,96,0.15)',
            borderColor:        'rgba(39,174,96,0.85)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(39,174,96,0.85)',
            pointRadius: 4,
          },
          {
            label: '不及格組',
            data: failVals,
            backgroundColor:    'rgba(231,76,60,0.12)',
            borderColor:        'rgba(231,76,60,0.85)',
            borderWidth: 2,
            pointBackgroundColor: 'rgba(231,76,60,0.85)',
            pointRadius: 4,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0, max: 100,
            ticks:       { stepSize: 20, color: clrTextDim, font: { size: 10 }, backdropColor: 'transparent' },
            grid:        { color: clrBorder },
            angleLines:  { color: clrBorder },
            pointLabels: { color: clrText, font: { size: 11 } },
          }
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: clrText, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              label: ctx => {
                const key    = RADAR_KEYS[ctx.dataIndex];
                const mcItem = (_currentSemData || _data)?.metrics_comparison?.[key];
                const gap    = mcItem?.gap_percentage;
                const gapStr  = gap != null && gap !== '' ? `（落差 ${gap}）` : '';
                return `${ctx.dataset.label}：${ctx.raw.toFixed(1)}${gapStr}`;
              }
            }
          }
        }
      }
    });
  }

  // ── §5.4 時序折線圖 ──────────────────────────────────────
  function renderTemporalChart(td) {
    const section = document.getElementById('rTemporalSection');
    if (!section) return;
    if (!td?.available) { section.style.setProperty('display', 'none'); return; }
    section.style.setProperty('display', '');

    const canvas = document.getElementById('rTemporalChart');
    if (!canvas) return;
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();

    const failSeries = td.weekly_activity_series?.fail_group ?? {};
    const passSeries = td.weekly_activity_series?.pass_group ?? {};
    const weeks = Object.keys(failSeries).sort((a, b) =>
      parseInt(a.replace('Week ', '')) - parseInt(b.replace('Week ', ''))
    );

    let annotationPlugin = {};
    try {
      if (window.ChartAnnotation) Chart.register(window.ChartAnnotation);
      const midWeekLabel = `Week ${td.midterm_week_num}`;
      const midIdx = weeks.indexOf(midWeekLabel);
      if (midIdx >= 0) {
        annotationPlugin = {
          annotation: {
            annotations: {
              midtermLine: {
                type: 'line',
                xMin: midIdx, xMax: midIdx,
                borderColor: 'rgba(231,76,60,0.7)',
                borderWidth: 2,
                borderDash: [6, 3],
                label: {
                  content:  `期中考 W${td.midterm_week_num}`,
                  display:  true,
                  position: 'start',
                  color:    '#e74c3c',
                  font:     { size: 11 },
                  backgroundColor: 'rgba(255,255,255,0.85)',
                }
              }
            }
          }
        };
      }
    } catch(e) {
      console.warn('[AtRisk] chartjs-plugin-annotation 載入失敗，期中考標注線以文字替代', e);
    }

    const { text: clrText, textDim: clrTextDim, border: clrBorder } = _resolveThemeColors();

    new Chart(canvas, {
      type: 'line',
      data: {
        labels: weeks,
        datasets: [
          {
            label: '及格組（週均分鐘）',
            data: weeks.map(w => passSeries[w] ?? null),
            borderColor:     'rgba(39,174,96,0.9)',
            backgroundColor: 'rgba(39,174,96,0.1)',
            borderWidth: 2, tension: 0.3, fill: true,
          },
          {
            label: '不及格組（週均分鐘）',
            data: weeks.map(w => failSeries[w] ?? null),
            borderColor:     'rgba(231,76,60,0.9)',
            backgroundColor: 'rgba(231,76,60,0.08)',
            borderWidth: 2, tension: 0.3, fill: true,
          },
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'bottom', labels: { color: clrText, font: { size: 12 } } },
          ...annotationPlugin,
        },
        scales: {
          x: { ticks: { color: clrTextDim, font: { size: 10 } }, grid: { color: clrBorder } },
          y: {
            ticks: { color: clrTextDim, font: { size: 10 } },
            grid:  { color: clrBorder },
            title: { display: true, text: '平均分鐘', color: clrTextDim, font: { size: 11 } },
          }
        }
      }
    });

    if (!Object.keys(annotationPlugin).length) {
      // WARN-1 FIX: 清除舊備注節點，防止 switchSemester 重複 append
      canvas.parentNode.querySelectorAll('.__midterm-note').forEach(n => n.remove());
      const note = document.createElement('div');
      note.className = '__midterm-note';
      note.className = '__midterm-note ladash-midterm-note-style';
      note.textContent = `▲ 紅色虛線標注不可用。期中考：Week ${td.midterm_week_num}`;
      canvas.parentNode.appendChild(note);
    }
  }

  // ── §5.5 紅旗警示卡 ──────────────────────────────────────
  // ── 第4類紅旗：提前預警摘要 ────────────────────────────
  // 僅在 _currentSem 等於目前提前預警目標學期（或 __all__）時顯示。
  // 沿用既有紅旗的「🔎定義→📊數據→💡解讀」三段式語氣，
  // 末段附連結引導至 sub-warning（個體層級完整清單）。
  function _buildWarningFlag() {
    if (!_warningData || !_warningSemester) return null;
    // WARN-ATRISK-1 FIX: 移除 '__all__' 條件。
    // __all__ 使用跨學期聚合資料，混入單一學期的提前預警摘要語意不一致。
    if (_currentSem !== _warningSemester) return null;

    const s = _warningData.summary;
    const m = _warningData.meta;
    // BUG-ATRISK-3 FIX: 原僅檢查 s 是否存在，後方仍直接存取 m.total_students、
    // m.data_cutoff、s.HIGH/MEDIUM/LOW.count；若預警模型未產出某風險等級或 meta
    // 缺漏，會拋出 TypeError 並中斷整個紅旗區塊渲染（switchSemester 無 try-catch
    // 保護時會連帶讓後續清理動作也不執行）。改為任一必要欄位缺漏即靜默跳過，
    // 與「提前預警資料載入失敗不影響主流程」的既有設計原則一致。
    const RISK_LEVELS = ['HIGH', 'MEDIUM', 'LOW'];
    if (!s || !m || RISK_LEVELS.some(lv => !s[lv] || typeof s[lv].count !== 'number')) {
      return null;
    }

    // 防呆：historical_fail_rate_ref 可能為 null（該風險等級在訓練集中無樣本）
    const _pct = (v) => (typeof v === 'number' && !isNaN(v)) ? `約 ${(v * 100).toFixed(0)}%` : '無歷史參考值';

    let body =
      `🔎 「提前預警」依111(1)–114(1)等已有期末成績學期建立的複合行為評分（BAS）` +
      `與題庫精熟指數（QMI）門檻，對 ${_warningSemester} 學期 ${m.total_students} 名學生` +
      `於期中考後進行分級預測（${m.data_cutoff ?? ''}）。\n\n` +
      `📊 高風險：${s.HIGH.count} 人（同等級歷史不及格率${_pct(s.HIGH.historical_fail_rate_ref)}）。\n` +
      `📊 中度風險：${s.MEDIUM.count} 人（${_pct(s.MEDIUM.historical_fail_rate_ref)}）。\n` +
      `📊 低風險：${s.LOW.count} 人（${_pct(s.LOW.historical_fail_rate_ref)}）。\n\n` +
      `💡 解讀：建議將高風險名單與上方其他紅旗警示（低完成率、連續零活動、期中後衰退）交叉比對，` +
      `若同一學生同時出現在多項警示中，應列為第一優先介入對象。` +
      `完整名單與個別篩選請至「🔮 提前預警」分頁查看。`;

    // 防線3：若已載入 validated 版本，補充驗證摘要
    if (_warningData?.meta && "validation_date" in _warningData.meta) {
      const cal  = _warningData.meta.validation_summary?.calibration;
      const date = new Date(_warningData.meta.validation_date).toLocaleDateString("zh-TW");
      const h    = cal?.HIGH;
      if (h && h.calibration_error != null) {
        const sign = h.calibration_error >= 0 ? "+" : "";
        body += `\n\n✅ 驗證結果（${date}，${_warningSemester}學期）：` +
          `高風險組實際不及格率 ${(h.actual_fail_rate * 100).toFixed(1)}%` +
          `（預測 ${(h.predicted_fail_rate * 100).toFixed(1)}%，` +
          `校準誤差 ${sign}${(h.calibration_error * 100).toFixed(1)}pp）。`;
      }
    }

    return {
      icon: '🔮',
      title: `本學期提前預警：高風險 ${s.HIGH.count} 人 / 中度風險 ${s.MEDIUM.count} 人 / 低風險 ${s.LOW.count} 人`,
      body, color: '#3498db', multiline: true,
    };
  }

  function renderRedFlags(bm, td) {
    const el = document.getElementById('rRedFlags');
    if (!el) return;
    const flags = [];

    (bm?.low_completion_flags ?? []).forEach(f => {
      const labelMap = {
        text_material_completion: 'TXT 文字教材',
        supplementary_completion: 'SUP 門檻解鎖教材（補充筆記／動畫解析）',
        tutoring_resource_rate:   'TUT 輔導資源（課輔／解題影片）',
      };
      const metricName = labelMap[f.metric] ?? f.metric;
      const threshold  = f.threshold_pct;
      const failPct    = (f.ratio_in_fail_group * 100).toFixed(0);
      const passPct    = (f.ratio_in_pass_group * 100).toFixed(0);
      const failAbove  = 100 - Number(failPct);
      const gapPct     = (Number(failPct) - Number(passPct)).toFixed(0);

      const body =
        `🔎 門檻定義：完成率低於 ${threshold}% 即視為「未達標」。\n\n` +
        `📊 不及格組：有 ${failPct}% 的不及格學生完成率低於 ${threshold}%，` +
        `也就是說這群學生中，每 100 人就有約 ${failPct} 人未達標，` +
        `僅 ${failAbove} 人有完成到門檻以上。\n\n` +
        `📊 及格組：也有 ${passPct}% 的及格學生完成率低於 ${threshold}%，` +
        `代表及格組同樣有 ${passPct} 人未達標（但比例遠低於不及格組）。\n\n` +
        `💡 解讀：兩組都有人低於門檻，但不及格組的比例（${failPct}%）遠高於及格組（${passPct}%），` +
        `差距 ${gapPct} 個百分點，顯示「${metricName}不足」是不及格的顯著風險因子。`;

      flags.push({
        icon: '⚠️', title: `${metricName} 完成率偏低警示（門檻：${threshold}%）`,
        body, color: '#e74c3c', multiline: true,
      });
    });

    const czw = td?.available ? td.consecutive_zero_weeks : null;
    if (czw?.fail_group_median >= 2) {
      const failMed = czw.fail_group_median;
      const passMed = czw.pass_group_median ?? 0;
      const diff    = failMed - passMed;
      const body =
        `🔎 「連續零活動週」是指學生連續數週完全沒有任何學習記錄（登入、閱讀、作答等均為零）。\n\n` +
        `📊 不及格組：中位數為 ${failMed} 週，代表有一半以上的不及格學生，整學期累計有至少 ${failMed} 週完全沒有學習活動。\n\n` +
        `📊 及格組：中位數為 ${passMed} 週，比不及格組少約 ${diff} 週的停擺期，學習連續性明顯較好。\n\n` +
        `💡 解讀：「學習中斷」是不及格的重要預警信號。建議在學生連續 2 週無活動時，主動發出提醒或課輔邀請。`;
      flags.push({
        icon: '🔴', title: `學習中斷警示：不及格組平均連續停擺 ${failMed} 週（及格組僅 ${passMed} 週）`,
        body, color: '#e67e22', multiline: true,
      });
    }

    const decayFail = td?.available ? td.post_midterm_decay_rate?.fail_group_median_pct : null;
    if (decayFail != null && decayFail <= -35) {
      const absDecayFail = Math.abs(decayFail).toFixed(1);
      const absDecayPass = Math.abs(td.post_midterm_decay_rate?.pass_group_median_pct ?? 0).toFixed(1);
      const body =
        `🔎 「期中後學習衰退率」是比較每位學生「期中考後」與「期中考前」的週平均學習分鐘數，計算下降幅度（百分比）。負值代表學習量減少。\n\n` +
        `📊 不及格組：中位數衰退幅度為 ${absDecayFail}%，代表有一半以上的不及格學生，在期中考結束後學習量掉了將近 ${absDecayFail}%。這是相當顯著的學習崩潰跡象。\n\n` +
        `📊 及格組：同期衰退幅度為 ${absDecayPass}%，雖然也有下降，但幅度明顯小於不及格組。\n\n` +
        `💡 解讀：不及格組在期中考後的大幅衰退，可能反映學生「看到成績不佳後放棄」或「期中前的衝刺無法持續」。建議在期中考後主動發出個人化的學習鼓勵，並提供補救資源。`;
      flags.push({
        icon: '📉', title: `期中考後學習量大幅衰退：不及格組下降 ${absDecayFail}%（及格組僅下降 ${absDecayPass}%）`,
        body, color: '#8e44ad', multiline: true,
      });
    }

    const warningFlag = _buildWarningFlag();
    if (warningFlag) flags.push(warningFlag);

    el.innerHTML = '';
    if (!flags.length) {
      const notice = document.createElement('div');
      notice.className = 'r-empty-notice';
      notice.textContent = '✅ 本學期無重大紅旗警示。';
      el.appendChild(notice);
      return;
    }
    const flagHeading = document.createElement('h3');
    flagHeading.className = 'r-section-heading';
    flagHeading.textContent = '🚩 紅旗警示';
    el.appendChild(flagHeading);

    flags.forEach(f => {
      const card = document.createElement('div');
      card.className = 'r-flag-card';
      card.style.setProperty('--flag-color', f.color);

      const icon = document.createElement('span');
      icon.className   = 'r-flag-icon';
      icon.textContent = f.icon;

      const content = document.createElement('div');
      content.className = 'r-flag-content';

      const title = document.createElement('div');
      title.className   = 'r-flag-title';
      title.textContent = f.title;

      const body = document.createElement('div');
      body.className   = 'r-flag-body' + (f.multiline ? ' r-flag-body--multiline' : '');
      body.textContent = f.body;

      content.appendChild(title);
      content.appendChild(body);
      card.appendChild(icon);
      card.appendChild(content);
      el.appendChild(card);
    });
  }

  // ── §5.6 處方性建議 ──────────────────────────────────────
  function renderPrescriptions(ps) {
    const el = document.getElementById('rPrescriptions');
    if (!el) return;
    const severityLabel = { critical: '高優先', warning: '中優先', info: '建議' };
    const severityColor = { critical: '#e74c3c', warning: '#e67e22', info: '#3498db' };
    const FALLBACK_COLOR = '#6c757d';
    el.innerHTML = '';
    if (!ps?.length) {
      const notice = document.createElement('div');
      notice.className = 'r-empty-notice';
      notice.textContent = '✅ 本學期無改善建議項目。';
      el.appendChild(notice);
      return;
    }

    const prescHeading = document.createElement('h3');
    prescHeading.className = 'r-section-heading';
    prescHeading.textContent = '💡 改善建議';
    el.appendChild(prescHeading);

    ps.forEach((item, i) => {
      const sev      = String(item.severity ?? '');
      const sevColor = severityColor[sev] ?? FALLBACK_COLOR;
      const sevLabel = severityLabel[sev] || sev || '未知';

      const card = document.createElement('div');
      card.className = 'r-presc-card';

      const header = document.createElement('div');
      header.className = 'r-presc-header';

      const badge = document.createElement('span');
      badge.className = 'r-presc-badge';
      badge.style.setProperty('--sev-color', sevColor);
      badge.textContent = sevLabel;

      const idx = document.createElement('span');
      idx.className   = 'r-presc-index';
      idx.textContent = `#${i + 1}`;

      header.appendChild(badge);
      header.appendChild(idx);

      const finding = document.createElement('div');
      finding.className   = 'r-presc-finding';
      finding.textContent = `📌 ${item.finding ?? ''}`;

      const action = document.createElement('div');
      action.className   = 'r-presc-action';
      action.textContent = `→ ${item.action ?? ''}`;

      card.appendChild(header);
      card.appendChild(finding);
      card.appendChild(action);
      el.appendChild(card);
    });
  }

  // ── §5.7 Top Risk Factors：XGBoost feature importance ──────
  // 資料來源 cross_analysis.json 的 feature_importance（與 tab-behavior-cross.js
  // 同一份資料，經 BehaviorLoader 快取，非獨立 xgb_feature_importance.json）。
  // 規格書第10.3節：檔案/資料不存在時 fallback 空陣列，不報錯。
  function renderTopRiskFactors(fi) {
    const el = document.getElementById('rTopRiskFactors');
    if (!el) return;
    el.innerHTML = '';

    if (!fi?.length) {
      const notice = document.createElement('div');
      notice.className = 'r-empty-notice';
      notice.textContent = '尚無 XGBoost 預測特徵重要性資料（需 ETL 啟用 --enable-xgb 且訓練樣本充足）。';
      el.appendChild(notice);
      return;
    }

    const heading = document.createElement('h3');
    heading.className = 'r-section-heading';
    heading.textContent = '📊 Top Risk Factors（XGBoost 特徵重要性）';
    el.appendChild(heading);

    const top = fi.slice(0, 8);
    const maxImp = Math.max(0, ...top.map((f) => f.importance || 0));

    top.forEach((f) => {
      const pct = maxImp > 0 ? Math.round(((f.importance || 0) / maxImp) * 100) : 0;

      const row = document.createElement('div');
      row.className = 'r-feat-row';

      const name = document.createElement('div');
      name.className = 'r-feat-name';
      name.textContent = f.feature ?? '';
      name.title = f.feature ?? '';

      const barWrap = document.createElement('div');
      barWrap.className = 'r-feat-bar';
      const barFill = document.createElement('div');
      barFill.className = 'r-feat-bar-fill';
      barFill.style.setProperty('--bar-width', `${pct}%`);
      barWrap.appendChild(barFill);

      const val = document.createElement('div');
      val.className = 'r-feat-val';
      val.textContent = Number(f.importance ?? 0).toFixed(4);

      row.appendChild(name);
      row.appendChild(barWrap);
      row.appendChild(val);
      el.appendChild(row);
    });
  }

  // ── §6.2 PDF 匯出 ────────────────────────────────────────
  // @public — HTML onclick 呼叫點（onclick="exportAtRiskPDF()"），
  // 無法納入 return{}，以 window.XXX 掛載為有意設計。
  window.exportAtRiskPDF = function() {
    // BUG-ATRISK-7 FIX: 若 1 秒內重複點擊，舊的 setTimeout 尚未觸發移除，
    // 會疊加多個同 id 的 <style> 節點。先清掉殘留節點再建立新的。
    document.getElementById('__rPrintStyle')?.remove();
    const style = document.createElement('style');
    style.id = '__rPrintStyle';
    const _nonce = document.querySelector('meta[name=csp-nonce]')?.content || '';
    if (_nonce) style.setAttribute('nonce', _nonce);
    style.textContent = `
      @media print {
        body > *:not(#panelR) { display: none !important; }
        #panelR { display: block !important; }
        #rLoading, #rNoData { display: none !important; }
        #rContent { display: block !important; }
        .tab-bar, header, #panelR button { display: none !important; }
        canvas { max-width: 100% !important; }
      }`;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => document.getElementById('__rPrintStyle')?.remove(), 1000);
  };

  // @public — main.js actionMap 呼叫（data-action="toggleRRadarInfo"）
  // MOBILE-FIX: 改為 position:fixed 定位（對稱 warningHelpPanel），
  // 避免 position:absolute 在手機上被父元素寬度限制或 overflow 截斷。
  window.toggleRRadarInfo = function(e) {
    // main.js STOP_PROPAGATION_ACTIONS 已 stopPropagation，此處不需重複
    const panel = document.getElementById('rRadarInfoPanel');
    const btn   = document.getElementById('rRadarInfoBtn');
    if (!panel || !btn) return;
    const isOpen = panel.classList.contains('open');
    panel.classList.toggle('open', !isOpen);
    if (!isOpen) {
      // 切換為 position:fixed 並計算座標（同 ui-toggles.js positionFixed 邏輯）
      const rect = btn.getBoundingClientRect();
      const vpW  = window.innerWidth;
      const vpH  = window.innerHeight;
      const maxW = parseInt(panel.dataset.maxw || '360', 10);
      const popW = panel.offsetWidth || Math.min(vpW * 0.92, maxW);
      const popH = panel.offsetHeight || 360;
      let left = rect.left;
      if (left + popW > vpW - 8) left = vpW - popW - 8;
      if (left < 8) left = 8;
      let top = rect.bottom + 6;
      if (top + popH > vpH - 8) {
        top = rect.top - popH - 6;
        if (top < 8) top = 8;
      }
      panel.style.setProperty('position', 'fixed');
      panel.style.setProperty('top',  top  + 'px');
      panel.style.setProperty('left', left + 'px');
      panel.style.setProperty('width', Math.min(vpW * 0.92, maxW) + 'px');
    }
  };

  // @public — at-risk-report.js 暴露，main.js actionMap 呼叫
  window.toggleBStatsHelp = function(e) {
    // main.js STOP_PROPAGATION_ACTIONS 已 stopPropagation
    const panel = document.getElementById('bStatsHelpPanel');
    if (!panel) return;
    panel.style.setProperty('display', panel.style.getPropertyValue('display') === 'none' ? '' : 'none');
  };

  document.addEventListener('click', function(e) {
    // bStatsHelpPanel 外部關閉：由 ui-toggles.js 的 MutationObserver 模式管理，
    // 此處僅保留 rRadarInfoPanel 的外部關閉（chart-popover position:fixed 模式）
    const rPanel = document.getElementById('rRadarInfoPanel');
    const rBtn   = document.getElementById('rRadarInfoBtn');
    if (rPanel && rPanel.classList.contains('open') &&
        !rPanel.contains(e.target) && !rBtn?.contains(e.target)) {
      rPanel.classList.remove('open');
    }
  });

  // ── 主要初始化（lazyInit 模式） ──────────────────────────
  // ── §0 模組樣式注入（CSP 合規：adoptedStyleSheets，無 <style> 標籤） ──
  // adoptedStyleSheets 屬於 JS DOM API（script-src 管轄），
  // 完全不觸發 style-src 'unsafe-inline' 限制。
  // 使用 document.getElementById('__atRiskStyles') 作為注入守衛，
  // 避免多次呼叫 lazyInit 時重複掛載（例如 tab 切換回來觸發 resize 路徑之外的重入）。
  function _injectModuleStyles() {
    if (document.getElementById('__atRiskStyles')) return;
    const guard = document.createElement('meta');
    guard.id = '__atRiskStyles';
    document.head.appendChild(guard);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      /* ── §5.2 班級概況卡片 ─────────────────────────────── */
      .r-cohort-card {
        flex: 1;
        min-width: 120px;
        background: var(--card-bg, #fff);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 10px;
        padding: 14px 16px;
        text-align: center;
      }
      .r-cohort-card--clickable {
        cursor: pointer;
        transition: box-shadow .15s, opacity .15s;
      }
      .r-cohort-value {
        font-size: 22px;
        font-weight: 700;
        color: var(--card-accent);
      }
      .r-cohort-unit {
        font-size: 13px;
        font-weight: 400;
      }
      .r-cohort-label {
        font-size: 11px;
        color: var(--text-dim, #888);
        margin-top: 4px;
      }

      /* ── §5.1 學期篩選按鈕 ─────────────────────────────── */
      .r-sem-btn {
        font-size: 12px;
        padding: 4px 14px;
        border-radius: 20px;
        border: 1px solid var(--border, #ccc);
        background: var(--card-bg, #fff);
        color: var(--text, #333);
        cursor: pointer;
        transition: background .15s, color .15s;
      }

      /* ── §5.5 / §5.6 共用 ──────────────────────────────── */
      .r-empty-notice {
        color: var(--text-dim, #888);
        font-size: 13px;
        padding: 8px 0;
      }
      .r-section-heading {
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
        margin-bottom: 8px;
      }

      /* ── §5.5 紅旗警示卡片 ─────────────────────────────── */
      .r-flag-card {
        display: flex;
        gap: 10px;
        align-items: flex-start;
        background: var(--card-bg, #fff);
        border-left: 4px solid var(--flag-color);
        border-radius: 6px;
        padding: 12px 16px;
        margin-bottom: 12px;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      }
      .r-flag-icon {
        font-size: 20px;
        line-height: 1.4;
        flex-shrink: 0;
      }
      .r-flag-content {
        min-width: 0;
        flex: 1;
      }
      .r-flag-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--flag-color);
        margin-bottom: 6px;
      }
      .r-flag-body {
        font-size: 12px;
        color: var(--text-mid, #555);
        line-height: 1.75;
      }
      .r-flag-body--multiline {
        white-space: pre-line;
      }

      /* ── §5.6 處方性建議卡片 ───────────────────────────── */
      .r-presc-card {
        background: var(--card-bg, #fff);
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 8px;
        padding: 12px 14px;
        margin-bottom: 10px;
      }
      .r-presc-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }
      .r-presc-badge {
        background: var(--sev-color);
        color: #fff;
        border-radius: 4px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
      }
      .r-presc-index {
        font-size: 12px;
        color: var(--text-dim, #888);
      }
      .r-presc-finding {
        font-size: 13px;
        color: var(--text);
        margin-bottom: 4px;
      }
      .r-presc-action {
        font-size: 12px;
        color: var(--text-dim, #888);
      }

      /* ── §5.7 Top Risk Factors（XGBoost feature importance）──── */
      .r-feat-row {
        display: grid;
        grid-template-columns: 150px 1fr 64px;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
        font-size: 12px;
      }
      .r-feat-name {
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .r-feat-bar {
        height: 8px;
        border-radius: 4px;
        background: var(--border, #e0e0e0);
        overflow: hidden;
      }
      .r-feat-bar-fill {
        height: 100%;
        width: var(--bar-width, 0%);
        background: var(--accent, #3498db);
        border-radius: 4px;
      }
      .r-feat-val {
        color: var(--text-dim, #888);
        text-align: right;
        font-variant-numeric: tabular-nums;
      }
    `);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }

  async function lazyInit() {
    if (_initialized) {
      requestAnimationFrame(() => {
        ['rRadarChart', 'rTemporalChart'].forEach(id => {
          const c = document.getElementById(id);
          if (c) { const inst = Chart.getChart(c); if (inst) { inst.resize(); inst.update('none'); } }
        });
      });
      return;
    }

    _injectModuleStyles();

    const rLoading = document.getElementById('rLoading');
    const rNoData  = document.getElementById('rNoData');
    const rContent = document.getElementById('rContent');

    if (!rLoading || !rNoData || !rContent) return;

    rLoading.style.setProperty('display', '');
    rNoData.style.setProperty('display', 'none');
    rContent.style.setProperty('display', 'none');

    try {
        _data = await BehaviorLoader.load.atRisk();

      // 第4類紅旗資料源（不影響主流程，失敗則靜默跳過）
      try {
        if (typeof BehaviorLoader !== 'undefined' &&
            typeof BehaviorLoader.loadWarningForCurrentTarget === 'function') {
          const w = await BehaviorLoader.loadWarningForCurrentTarget();
          if (w) {
            _warningSemester = w.semester;
            _warningData     = w.data;
          }
        }
      } catch (e) {
        console.warn('[AtRiskReportManager] 提前預警資料載入失敗（不影響主流程）:', e);
      }

      // 第5類資料源：XGBoost feature importance（不影響主流程，失敗則靜默跳過）
      try {
        if (typeof BehaviorLoader !== 'undefined' && BehaviorLoader.load?.crossAnalysis) {
          const cross = await BehaviorLoader.load.crossAnalysis();
          _featureImportance = Array.isArray(cross?.feature_importance) ? cross.feature_importance : [];
        }
      } catch (e) {
        console.warn('[AtRiskReportManager] feature_importance 載入失敗（不影響主流程）:', e);
      }

      if (!_data.schema_version || parseFloat(_data.schema_version) < 2.0) {
        throw new Error(
          `at_risk_profile.json schema_version 不相容（需 ≥ 2.0，實際 ${_data.schema_version ?? 'unknown'}）。請重新執行 ETL。`
        );
      }

      // schema 3.0：多學期結構
      if (parseFloat(_data.schema_version) >= 3.0 && _data.by_semester) {
        const sems = _data.available_semesters ?? Object.keys(_data.by_semester);
        const def  = _data.default_semester ?? sems[sems.length - 1];
        _currentSem     = def;
        _currentSemData = _data.by_semester[def];

        renderSemesterFilter(sems, def);
        renderCohortSummary(_currentSemData.cohort_summary);
        renderRadarChart(_currentSemData.metrics_comparison);
        renderTemporalChart(_currentSemData.temporal_decay);
        renderRedFlags(_currentSemData.behavioral_markers, _currentSemData.temporal_decay);
        renderPrescriptions(_currentSemData.prescriptive_summary);
        renderTopRiskFactors(_featureImportance);

      // schema 2.x：降級單學期
      } else {
        renderCohortSummary(_data.cohort_summary);
        renderRadarChart(_data.metrics_comparison);
        renderTemporalChart(_data.temporal_decay);
        renderRedFlags(_data.behavioral_markers, _data.temporal_decay);
        renderPrescriptions(_data.prescriptive_summary);
        renderTopRiskFactors(_featureImportance);
      }

      rLoading.style.setProperty('display', 'none');
      rContent.style.setProperty('display', '');
      _initialized = true;

    } catch(e) {
      rLoading.style.setProperty('display', 'none');
      if (rNoData) {
        rNoData.style.setProperty('display', '');
        const msgEl = document.getElementById('rNoDataMsg');
        if (msgEl) msgEl.textContent = `無法載入報告資料：${e.message}`;
      }
      console.error('[AtRiskReportManager] 初始化失敗', e);
    }
  }

  // ── 公開 API ─────────────────────────────────────────────
  return {
    lazyInit,
    filterRadar,
    switchSemester,
    reRenderRadar: () => {
      const mc = _currentSemData?.metrics_comparison ?? _data?.metrics_comparison;
      if (mc) renderRadarChart(mc);
    },
  };
})();
