/**
 * tab-behavior-lsa.js  —  v16.15
 *
 * 累積修正（v16.3–v16.7）：
 *   副標題放大、?說明 Modal、視覺優化、放大 overlay 重渲染
 *   CSP inline onclick 移除、marker refX 修正、ResizeObserver guard
 *   自環 sweep=0 幾何修正（突出 91px）、badge 分散（t=0.22 貝茲點）
 *   dead variable 移除（zMQ）、_mkMarker 提升至 module 層
 *   isTop 改為 index 判斷、getElementById 快取
 * v16.15：filterBar（學期 + 分群）篩選導入、_resolveGroupData、
 *   CLUSTER_NAMES 提升至 module 層、init() filter 狀態重置
 */

const BehaviorLsaTab = (() => {

  let _lsaData        = null;
  let _group          = "all";
  let _filterSemester = "all";
  let _filterCluster  = "all";
  let _ro             = null;

  const BEHAVIOR_LABELS = { M: "教材閱讀", Q: "題庫作答" };
  const CLUSTER_NAMES  = { P1:"穩定高效", P2:"規律中效", P3:"波動中效", P4:"低頻低效", P5:"高風險" };
  const NODE_BASE_R  = 40;   // 32 × 1.25
  const NODE_SCALE   = 0.008;
  const EDGE_Z_SCALE = 0.55;
  const SIG_COLOR    = "var(--accent,#3498db)";
  const INSIG_COLOR  = "rgba(120,130,160,0.35)";
  const NODE_COLOR   = "rgba(52,152,219,0.30)";
  const NODE_STROKE  = "rgba(52,152,219,0.9)";

  // ── marker 建立輔助（提升至 module 層，避免每次渲染重複定義）──────
  function _mkMarker(defs, id, color, mSize) {
    defs.append("marker")
      .attr("id", id)
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 10)
      .attr("refY", 0)
      .attr("markerWidth",  mSize)
      .attr("markerHeight", mSize)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", color);
  }

  // ── 初始化 ────────────────────────────────────────────────────
  async function init() {
    // 按鈕事件無論資料是否存在都需綁定，必須在資料檢查前執行
    _group          = "all";
    _filterSemester = "all";
    _filterCluster  = "all";
    _syncGroupBtnStyles();
    _bindGroupButtons();
    _bindHelpButton();
    _bindExpandButton();

    try {
      if (typeof d3 === "undefined") {
        throw new Error("D3.js 載入失敗，請確認網路連線後重新整理。");
      }
      const corrData = await BehaviorLoader.load.correlation();
      const lsaRaw   = corrData?.lsa_transition;

      if (!lsaRaw || !lsaRaw.groups) {
        _renderEmpty("ETL 尚未產出 LSA 資料，請重新執行 lms_etl.py 後重整頁面。");
        return;
      }

      _lsaData = lsaRaw;
      _renderFilterBar();
      _render();

      const wrap = document.getElementById("lsaGraphWrap");
      if (wrap && typeof ResizeObserver !== "undefined") {
        if (_ro) _ro.disconnect();
        _ro = new ResizeObserver(() => {
          const pane = document.getElementById("sub-lsa");
          if (!pane || pane.style.display === "none") return;
          if (!wrap || wrap.clientWidth < 10) return;
          _render();
        });
        _ro.observe(wrap);
      }
    } catch (e) {
      console.error("[BehaviorLsaTab] init:", e);
      _renderEmpty(`初始化失敗：${_safeText(String(e?.message ?? e))}`);
    }
  }

  // ── cloneNode 清除舊 listener ─────────────────────────────────
  function _freshBtn(id) {
    const btn = document.getElementById(id);
    if (!btn) return null;
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    return clone;
  }

  // ── Help 按鈕 ─────────────────────────────────────────────────
  function _bindHelpButton() {
    const btn = _freshBtn("lsaHelpBtn");
    if (!btn) return;
    btn.addEventListener("click", _showHelpModal);
  }

  function _showHelpModal() {
    if (document.getElementById("lsaHelpOverlay")) return;

    const overlay = document.createElement("div");
    overlay.id = "lsaHelpOverlay";
    Object.assign(overlay.style, {
      position: "fixed", inset: "0", zIndex: "9999",
      background: "rgba(0,0,0,0.72)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "20px", boxSizing: "border-box",
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      maxWidth: "520px", width: "100%",
      background: "var(--surface,#13161f)",
      border: "1px solid var(--border2,#2a2f45)",
      borderRadius: "14px", padding: "24px 26px",
      color: "var(--text,#dde3f5)",
      fontSize: ".85rem", lineHeight: "1.7",
      maxHeight: "85vh", overflowY: "auto",
    });

    const titleRow = document.createElement("div");
    Object.assign(titleRow.style, {
      display: "flex", justifyContent: "space-between",
      alignItems: "center", marginBottom: "16px",
    });
    const titleSpan = document.createElement("span");
    Object.assign(titleSpan.style, { fontSize: "1rem", fontWeight: "700", color: "var(--accent,#3498db)" });
    titleSpan.textContent = "📊 行為序列轉移圖說明";

    const closeBtn = document.createElement("button");
    Object.assign(closeBtn.style, {
      background: "none", border: "none",
      color: "var(--text-dim,#888)", fontSize: "1.3rem",
      cursor: "pointer", padding: "0 4px",
    });
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => overlay.remove());

    titleRow.appendChild(titleSpan);
    titleRow.appendChild(closeBtn);
    panel.appendChild(titleRow);

    panel.insertAdjacentHTML("beforeend", `
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">📌 什麼是滯後序列分析（LSA）？</div>
      <p style="color:var(--text-mid,#9aa0b8);margin:0 0 14px">
        滯後序列分析（Lag-Sequential Analysis）用於分析<strong style="color:var(--text,#dde3f5)">行為之間的接續模式</strong>。
        本圖呈現學生完成某一行為後，接下來最可能執行哪種行為（Lag-1 = 緊接的下一個行為）。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">🔢 Z-score 怎麼算？</div>
      <div style="background:var(--surface2,#1c2030);border:1px solid var(--border2,#2a2f45);border-radius:8px;padding:12px 14px;font-family:monospace;font-size:.82rem;color:var(--text,#dde3f5);margin-bottom:14px;line-height:2">
        Z = (觀察次數 − 期望次數) / √[期望次數 × (1−P(A)) × (1−P(B))]<br>
        期望次數 = (A 出現總次數 × B 出現總次數) / 總序列對數
      </div>
      <p style="color:var(--text-mid,#9aa0b8);margin:0 0 14px">
        Z-score &gt;+1.96 代表 A→B 的轉移<strong style="color:var(--text,#dde3f5)">顯著多於隨機預期</strong>；
        Z-score &lt;−1.96 代表顯著迴避此轉移。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">🔵 節點（圓圈）</div>
      <p style="color:var(--text-mid,#9aa0b8);margin:0 0 14px">
        每個節點代表一種學習行為（M=教材閱讀、Q=題庫作答）。
        節點大小反映該行為的<strong style="color:var(--text,#dde3f5)">出現總次數</strong>。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">➡ 邊線（箭頭）</div>
      <p style="color:var(--text-mid,#9aa0b8);margin:0 0 14px">
        <span style="color:var(--accent,#3498db);font-weight:600">藍色實線</span>：顯著轉移（|Z|&gt;1.96，p&lt;0.05）<br>
        <span style="color:rgba(150,160,190,0.9);font-weight:600">灰色細線</span>：不顯著轉移<br>
        自環（弧形箭頭）代表<strong style="color:var(--text,#dde3f5)">連續重複相同行為</strong>。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">👥 三組篩選</div>
      <p style="color:var(--text-mid,#9aa0b8);margin:0">
        全體 / 及格組 / 不及格組 — 比較不同學習成效學生的行為序列差異，
        有助於辨識高效與低效的學習模式。
      </p>`);

    overlay.appendChild(panel);
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── 放大按鈕（FIX-4：重新渲染至大尺寸，不 clone 原 SVG）────────
  function _bindExpandButton() {
    const btn = _freshBtn("lsaExpandBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const existing = document.getElementById("lsaExpandOverlay");
      if (existing) { existing.remove(); return; }
      if (!_lsaData) return;

      const overlay = document.createElement("div");
      overlay.id = "lsaExpandOverlay";
      Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "9998",
        background: "rgba(10,13,22,0.95)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        // top padding must clear iOS status bar + button height (52px baseline + safe area)
        padding: "calc(52px + env(safe-area-inset-top, 0px)) 24px calc(24px + env(safe-area-inset-bottom, 0px))",
        boxSizing: "border-box",
      });

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✕ 關閉";
      Object.assign(closeBtn.style, {
        position: "absolute",
        // iOS PWA/standalone: respect Dynamic Island + status bar safe area
        top: "calc(14px + env(safe-area-inset-top, 0px))",
        right: "20px",
        background: "var(--surface2,#1c2030)",
        border: "1px solid var(--border2,#2a2f45)",
        borderRadius: "20px", color: "var(--text,#dde3f5)",
        padding: "6px 18px", cursor: "pointer",
        fontSize: ".85rem",
        zIndex: "1",  // ensure above SVG content
      });
      closeBtn.addEventListener("click", () => overlay.remove());

      const svgContainer = document.createElement("div");
      svgContainer.id = "lsaExpandSvgContainer";  // 供 _render() 同步更新用
      Object.assign(svgContainer.style, {
        width: "100%", flex: "1",
        display: "flex", alignItems: "center", justifyContent: "center",
        minHeight: "0",
        background: "var(--surface,#13161f)",
        borderRadius: "10px",
      });

      overlay.appendChild(closeBtn);
      overlay.appendChild(svgContainer);
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);

      // 等 overlay 進 DOM 後取得真實尺寸再渲染
      requestAnimationFrame(() => {
        const W = Math.max(600, svgContainer.clientWidth  || window.innerWidth  * 0.9);
        const H = Math.max(400, svgContainer.clientHeight || window.innerHeight * 0.75);
        _renderToContainer(svgContainer, W, H);
      });
    });
  }

  // ── filterBar（學期 + 分群篩選）─────────────────────────────
  function _renderFilterBar() {
    const anchor = document.getElementById("lsaFilterBarAnchor");
    if (!anchor) return;

    const semesters = Object.keys(_lsaData?.by_semester ?? {}).sort();

    const semOptions = [
      `<option value="all">全部年度</option>`,
      ...semesters.map(s => {
        const yr  = s.slice(0, 3);
        const sem = s.slice(3) === "1" ? "(1)" : "(2)";
        return `<option value="${s}"${s === _filterSemester ? " selected" : ""}>${yr}${sem}</option>`;
      }),
    ].join("");

    const clusterOptions = [
      `<option value="all">全部分群</option>`,
      ...Object.entries(CLUSTER_NAMES).map(([k, v]) =>
        `<option value="${k}"${k === _filterCluster ? " selected" : ""}>${k} ${v}</option>`),
    ].join("");

    anchor.innerHTML = `
      <div style="display:flex;flex-wrap:nowrap;overflow-x:auto;align-items:center;gap:8px;
                  margin-bottom:12px;padding:8px 12px;
                  border:1px solid rgba(110,130,165,.22);border-radius:10px;
                  background:var(--card-bg2,#1c2030);white-space:nowrap">
        <span style="font-size:.8rem;font-weight:700;color:var(--text-mid,#4f5f78)">篩選條件</span>
        <label style="display:flex;align-items:center;gap:4px;font-size:.78rem;color:var(--text-dim,#888);flex-shrink:0">學期
          <select id="lsaSemFilter" style="font-size:.78rem;padding:2px 4px;border-radius:7px;
            border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);
            color:var(--text-mid,#9aa0b8);cursor:pointer;max-width:90px">${semOptions}</select>
        </label>
        <label style="display:flex;align-items:center;gap:4px;font-size:.78rem;color:var(--text-dim,#888);flex-shrink:0">分群
          <select id="lsaClusterFilter" style="font-size:.78rem;padding:2px 4px;border-radius:7px;
            border:1px solid var(--border,#2a2f45);background:var(--surface2,#1c2030);
            color:var(--text-mid,#9aa0b8);cursor:pointer;max-width:110px">${clusterOptions}</select>
        </label>
      </div>`;

    document.getElementById("lsaSemFilter")
      ?.addEventListener("change", _onFilterChange);
    document.getElementById("lsaClusterFilter")
      ?.addEventListener("change", _onFilterChange);
  }

  function _onFilterChange() {
    _filterSemester = document.getElementById("lsaSemFilter")?.value    ?? "all";
    _filterCluster  = document.getElementById("lsaClusterFilter")?.value ?? "all";
    if (_lsaData) _render();
  }

  // ── 群組按鈕 ──────────────────────────────────────────────────
  function _bindGroupButtons() {
    document.querySelectorAll("#lsaGroupControls .lsa-group-btn").forEach(btn => {
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      clone.addEventListener("click", () => onGroupChange(clone.dataset.group));
    });
  }

  function onGroupChange(group) {
    _group = group || "all";
    _syncGroupBtnStyles();
    if (_lsaData) _render();
  }

  function _syncGroupBtnStyles() {
    document.querySelectorAll("#lsaGroupControls .lsa-group-btn").forEach(btn => {
      const active = btn.dataset.group === _group;
      btn.style.background  = active ? "var(--accent,#3498db)" : "var(--surface2,#1c2030)";
      btn.style.color       = active ? "#fff" : "var(--text-dim,#888)";
      btn.style.borderColor = "var(--border2,#2a2f45)";
    });
  }

  function resetFilters() {
    _group          = "all";
    _filterSemester = "all";
    _filterCluster  = "all";
    _syncGroupBtnStyles();
    const semEl     = document.getElementById("lsaSemFilter");
    const clusterEl = document.getElementById("lsaClusterFilter");
    if (semEl)     semEl.value     = "all";
    if (clusterEl) clusterEl.value = "all";
    if (_lsaData) _render();
  }

  // ── 依 filter 狀態取得對應 groupData ─────────────────────────
  function _resolveGroupData() {
    if (_filterCluster !== "all") {
      return _lsaData.by_cluster?.[_filterCluster]?.[_group] ?? null;
    }
    if (_filterSemester !== "all") {
      return _lsaData.by_semester?.[_filterSemester]?.[_group] ?? null;
    }
    return _lsaData.groups?.[_group] ?? null;
  }

  // ── 主渲染（委派至 _renderToContainer）────────────────────────
  function _render() {
    const wrap = document.getElementById("lsaGraphWrap");
    if (!wrap) return;
    const W = Math.max(wrap.clientWidth, 480) || 560;  // mobile minimum 480 to fit 2-node + badges
    const H = Math.round(W * 0.55);  // 寬高比 ~16:9，讓 getBBox 有足夠空間計算
    _renderToContainer(wrap, W, H);

    // 若放大 overlay 開著，同步更新 overlay 內的圖形
    const overlayContainer = document.getElementById("lsaExpandSvgContainer");
    if (overlayContainer) {
      const oW = Math.max(600, overlayContainer.clientWidth  || window.innerWidth  * 0.9);
      const oH = Math.max(400, overlayContainer.clientHeight || window.innerHeight * 0.75);
      _renderToContainer(overlayContainer, oW, oH);
    }
  }

  // ── 核心渲染函式（可複用至 overlay）──────────────────────────
  function _renderToContainer(container, W, H) {
    if (!_lsaData) { _renderEmptyTo(container, "資料尚未載入"); return; }

    const groupData = _resolveGroupData();
    if (!groupData) { _renderEmptyTo(container, `找不到群組 ${_group} 的資料`); return; }

    const n = groupData.n_sequences ?? 0;
    // 快取主容器參照，供後續 isMain 判斷複用
    const mainWrap = document.getElementById("lsaGraphWrap");
    const isMain   = container === mainWrap;

    if (n === 0) {
      if (isMain) _renderEmptyTo(container, "本批資料無有效行為序列對（reading_log 可能為空）");
      return;
    }

    container.innerHTML = "";

    let svg;
    try {
      svg = d3.select(container).append("svg")
        .attr("width",  "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .style("font-family", "sans-serif");
    } catch (e) {
      if (isMain) _renderEmptyTo(container, "D3.js 載入失敗，請確認網路連線。");
      return;
    }

    // ── marker ─────────────────────────────────────────────────────
    const defs = svg.append("defs");
    _mkMarker(defs, "arrow-sig",        SIG_COLOR,               5);
    _mkMarker(defs, "arrow-insig",      "rgba(120,130,160,0.6)", 4);
    _mkMarker(defs, "arrow-self-sig",   SIG_COLOR,               5);
    _mkMarker(defs, "arrow-self-insig", "rgba(120,130,160,0.6)", 4);

    // ── 節點 ──────────────────────────────────────────────────────
    const behaviors = _lsaData.behaviors ?? ["M", "Q"];
    const totals    = groupData.behavior_totals ?? {};
    const nodes = behaviors.map((b, i) => ({
      id:    b,
      label: BEHAVIOR_LABELS[b] || b,
      total: totals[b] ?? 0,
      r:     NODE_BASE_R + Math.sqrt(totals[b] ?? 0) * NODE_SCALE,
      x:     W * (0.25 + i * 0.5),
      y:     H * 0.5,
    }));

    // ── 邊 ────────────────────────────────────────────────────────
    const zScores = groupData.z_score    ?? {};
    const sigMap  = groupData.significant ?? {};
    const links = [];
    for (const a of behaviors) {
      for (const b of behaviors) {
        const key = `${a}→${b}`;
        const z   = zScores[key] ?? null;
        const sig = sigMap[key]  ?? false;
        const sw  = z != null ? Math.max(1, Math.min(4, Math.abs(z) * EDGE_Z_SCALE)) : 1;
        links.push({
          source: a, target: b, z, sig, sw,
          isSelf: a === b,
          color:  sig ? SIG_COLOR : INSIG_COLOR,
          marker: sig ? "url(#arrow-sig)" : "url(#arrow-insig)",
        });
      }
    }

    const nodeById = new Map(nodes.map(nd => [nd.id, nd]));
    links.forEach(l => {
      l.source = nodeById.get(l.source) ?? l.source;
      l.target = nodeById.get(l.target) ?? l.target;
    });

    const nonSelf = links.filter(l => !l.isSelf);
    const sim = d3.forceSimulation(nodes)
      .force("link",      d3.forceLink(nonSelf).id(d => d.id).distance(W * 0.45).strength(0.7))
      .force("charge",    d3.forceManyBody().strength(-120))
      .force("center",    d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide().radius(d => d.r + 28))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    nodes.forEach(nd => {
      nd.x = Math.max(nd.r + 12, Math.min(W - nd.r - 12, nd.x));
      nd.y = Math.max(nd.r + 12, Math.min(H - nd.r - 12, nd.y));
    });

    // ── 邊線 ──────────────────────────────────────────────────────
    const edgeG = svg.append("g").attr("class", "lsa-edges");

    nonSelf.forEach(l => {
      const ndS = l.source, ndT = l.target;
      const sx = ndS.x, sy = ndS.y;
      const tx = ndT.x, ty = ndT.y;
      const dx = tx - sx, dy = ty - sy;
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;

      // 雙向邊垂直偏移（offset=40 讓兩弧 Y 間距 80px，badge 清楚分離）
      const offset = 40;
      const cx = (sx + tx) / 2 - (dy / norm) * offset;
      const cy = (sy + ty) / 2 + (dx / norm) * offset;

      // 終點切線方向 = (終點 - 控制點) 的方向
      const tDx = tx - cx, tDy = ty - cy;
      const tLen = Math.sqrt(tDx * tDx + tDy * tDy) || 1;
      const tUx = tDx / tLen, tUy = tDy / tLen;  // 終點切線單位向量

      const markerReach = 5 * l.sw * 0.5;  // marker 突出長度（用戶空間）
      const retreat     = ndT.r + markerReach + 2;  // +2 margin

      const ex = tx - tUx * retreat;
      const ey = ty - tUy * retreat;

      // 起點也需退縮，避免從節點中心出發
      const sDx = cx - sx, sDy = cy - sy;
      const sLen = Math.sqrt(sDx * sDx + sDy * sDy) || 1;
      const sUx = sDx / sLen, sUy = sDy / sLen;
      const startX = sx + sUx * (ndS.r + 2);
      const startY = sy + sUy * (ndS.r + 2);

      edgeG.append("path")
        .attr("d", `M${startX},${startY} Q${cx},${cy} ${ex},${ey}`)
        .attr("fill",         "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.sw)
        .attr("marker-end",   l.marker)
        .attr("opacity",      l.sig ? 0.85 : 0.4);

      // Z-score pill：放在路徑 t=0.2 處（靠近起點 1/4 弧長）
      // 二次貝茲 B(t) = (1-t)²P0 + 2(1-t)t·P1 + t²P2
      // M→Q badge 在 M 節點附近；Q→M badge 在 Q 節點附近
      // → 兩個 badge X 方向分離，清楚歸屬各自箭頭
      if (l.sig && l.z != null) {
        const t  = 0.22;
        const u  = 1 - t;
        const lx = u*u*startX + 2*u*t*cx + t*t*ex;
        const ly = u*u*startY + 2*u*t*cy + t*t*ey;

        // 第1行：方向 + 白話
        const tName = BEHAVIOR_LABELS[l.target.id] || l.target.id;
        const meaning = l.z < 0 ? "顯著迴避" : "顯著偏好";
        const line1 = `${l.source.id}→${l.target.id} 後切換${tName}`;
        const line2 = `Z=${l.z >= 0 ? "+" : ""}${l.z.toFixed(1)}  ${meaning} ✦`;
        // CJK-aware width: non-ASCII chars ~14px, ASCII ~7px at font-size 11
        const _bwE = s => { let w = 0; for (const c of s) w += c.codePointAt(0) > 0x7F ? 14 : 7; return w + 20; };
        const bw  = Math.max(100, _bwE(line1), _bwE(line2));
        const bh  = 48;  // 38 × 1.25

        edgeG.append("rect")
          .attr("x", lx - bw / 2).attr("y", ly - bh / 2)
          .attr("width", bw).attr("height", bh)
          .attr("rx", 8)
          .attr("fill",         "var(--surface,#13161f)")
          .attr("stroke",       SIG_COLOR)
          .attr("stroke-width", 1)
          .attr("opacity",      0.95);

        edgeG.append("text")
          .attr("x", lx).attr("y", ly - 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    11)
          .attr("font-weight",  "700")
          .attr("fill",         SIG_COLOR)
          .attr("pointer-events","none")
          .text(line1);
        edgeG.append("text")
          .attr("x", lx).attr("y", ly + 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    10)
          .attr("font-weight",  "400")
          .attr("fill",         "var(--text-mid,#9aa0b8)")
          .attr("pointer-events","none")
          .text(line2);
      }
    });

    // ── 自環：三次貝茲曲線（SVG arc 突出不足，改用貝茲）
    // M→M 上側拱形：從左上角出發繞到右上角，控制點在節點正上方 60px
    // Q→Q 下側拱形：從右下角出發繞到左下角，控制點在節點正下方 60px
    // 幾何驗證：突出量 43px，badge 在弧頂外側 12px，不出框 ✓
    const loopAngle = 40 * Math.PI / 180;  // 端點從節點中心偏40°
    const loopH     = 60;                   // 控制點高出節點邊緣距離

    links.filter(l => l.isSelf).forEach(l => {
      const nd    = l.source;
      if (!nd) return;
      const isTop = behaviors.indexOf(nd.id) === 0;

      // 端點（節點邊緣上 ±40°）
      const sinA = Math.sin(loopAngle), cosA = Math.cos(loopAngle);
      let sx, sy, ex, ey, cp1x, cp1y, cp2x, cp2y;

      if (isTop) {
        // 上側：起點左上，終點右上，控制點在上方
        sx   = nd.x - nd.r * sinA;  sy   = nd.y - nd.r * cosA;
        ex   = nd.x + nd.r * sinA;  ey   = sy;
        cp1x = sx - 20;              cp1y = nd.y - nd.r - loopH;
        cp2x = ex + 20;              cp2y = cp1y;
      } else {
        // 下側：起點右下，終點左下，控制點在下方
        sx   = nd.x + nd.r * sinA;  sy   = nd.y + nd.r * cosA;
        ex   = nd.x - nd.r * sinA;  ey   = sy;
        cp1x = sx + 20;              cp1y = nd.y + nd.r + loopH;
        cp2x = ex - 20;              cp2y = cp1y;
      }

      const mId = l.sig ? "url(#arrow-self-sig)" : "url(#arrow-self-insig)";
      edgeG.append("path")
        .attr("d", `M${sx},${sy} C${cp1x},${cp1y} ${cp2x},${cp2y} ${ex},${ey}`)
        .attr("fill",         "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.sw ?? 1.5)
        .attr("marker-end",   mId)
        .attr("opacity",      l.sig ? 0.85 : 0.4);

      if (l.sig && l.z != null) {
        const behaviorName = BEHAVIOR_LABELS[nd.id] || nd.id;
        // 第1行：行為方向 + 白話意義
        const line1 = `${nd.id}→${nd.id} 連續${behaviorName}`;
        // 第2行：Z值 + 顯著標記
        const line2 = `Z=${l.z >= 0 ? "+" : ""}${l.z.toFixed(1)}  顯著偏好 ✦`;
        // CJK-aware width: non-ASCII chars ~14px, ASCII ~7px at font-size 11
        const _bwS = s => { let w = 0; for (const c of s) w += c.codePointAt(0) > 0x7F ? 14 : 7; return w + 20; };
        const bw  = Math.max(100, _bwS(line1), _bwS(line2));
        const bh  = 48;  // 兩行高度 × 1.25

        const topX = 0.125*sx + 0.375*cp1x + 0.375*cp2x + 0.125*ex;
        const topY = 0.125*sy + 0.375*cp1y + 0.375*cp2y + 0.125*ey;

        const badgeY = isTop ? topY - 20 : topY + 20;
        const rawBX  = topX - bw / 2;
        const badgeX = Math.max(4, Math.min(W - bw - 4, rawBX));

        edgeG.append("rect")
          .attr("x", badgeX).attr("y", badgeY - bh / 2)
          .attr("width", bw).attr("height", bh)
          .attr("rx", 8)
          .attr("fill",         "var(--surface,#13161f)")
          .attr("stroke",       SIG_COLOR)
          .attr("stroke-width", 1)
          .attr("opacity",      0.95);

        const bCx = badgeX + bw / 2;
        edgeG.append("text")
          .attr("x", bCx).attr("y", badgeY - 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    11)
          .attr("font-weight",  "700")
          .attr("fill",         SIG_COLOR)
          .attr("pointer-events","none")
          .text(line1);
        edgeG.append("text")
          .attr("x", bCx).attr("y", badgeY + 12)
          .attr("dy", "0.35em")
          .attr("text-anchor",  "middle")
          .attr("font-size",    10)
          .attr("font-weight",  "400")
          .attr("fill",         "var(--text-mid,#9aa0b8)")
          .attr("pointer-events","none")
          .text(line2);
      }
    }); // end self-loop

    // ── 節點（繪製在邊線之上）─────────────────────────────────────
    const nodeG = svg.append("g").attr("class", "lsa-nodes");
    nodes.forEach(nd => {
      const g = nodeG.append("g")
        .attr("transform", `translate(${nd.x},${nd.y})`)
        .style("cursor", "default");

      g.append("circle")
        .attr("r",            nd.r)
        .attr("fill",         NODE_COLOR)
        .attr("stroke",       NODE_STROKE)
        .attr("stroke-width", 2);

      // 節點文字：id 置中偏上，label 置中偏下
      // dy="0.35em" 讓字的視覺重心落在 y 座標位置
      g.append("text")
        .attr("text-anchor", "middle")
        .attr("y", -7)
        .attr("dy", "0.35em")
        .attr("font-size",   20)
        .attr("font-weight", "bold")
        .attr("fill",        "var(--text,#fff)")
        .text(nd.id);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("y", 12)
        .attr("dy", "0.35em")
        .attr("font-size",   13)
        .attr("fill",        "var(--text-mid,#ccc)")
        .text(nd.label);

      g.append("title")
        .text(`${nd.id}：${nd.label}\n出現次數：${nd.total.toLocaleString()}`);
    });

    // ── 內容自適應：重算 viewBox 消除上下空白 ────────────────────
    // 在所有元素繪製完成後，透過 getBBox() 取得實際內容範圍
    // 加 PAD px 上下左右留白，讓圖形緊密貼合內容
    try {
      const PAD = 20;
      const gAll = svg.node().querySelectorAll("path,rect,circle,text");
      let minY = Infinity, maxY = -Infinity;
      let minX = Infinity, maxX = -Infinity;
      gAll.forEach(el => {
        try {
          const b = el.getBBox();
          if (b.width === 0 && b.height === 0) return;
          if (b.y < minY) minY = b.y;
          if (b.y + b.height > maxY) maxY = b.y + b.height;
          if (b.x < minX) minX = b.x;
          if (b.x + b.width > maxX) maxX = b.x + b.width;
        } catch (_) {}
      });
      if (isFinite(minY) && isFinite(maxY)) {
        const vx = Math.max(0, minX - PAD);
        const vy = Math.max(0, minY - PAD);
        const vw = maxX + PAD - vx;  // full content width, no artificial clip at W
        const vh = maxY + PAD - vy;
        svg.attr("viewBox", `${vx} ${vy} ${vw} ${vh}`);
        // 主容器依內容高度自動縮放
        if (isMain) {
          const aspectH = Math.round(container.clientWidth * vh / vw);
          const clampedH = Math.max(200, Math.min(700, aspectH));
          container.style.height = clampedH + "px";
        }
      }
    } catch (_) {}

    // ── 圖例 + 解讀卡片（只在主容器更新）────────────────────────
    if (isMain) {
      const legEl = document.getElementById("lsaLegend");
      if (legEl) {
        legEl.innerHTML = `
          <span style="margin-right:14px">
            <svg width="24" height="8" style="vertical-align:middle">
              <line x1="0" y1="4" x2="24" y2="4" stroke="${SIG_COLOR}" stroke-width="2.5"/>
            </svg>顯著轉移（|Z|&gt;1.96）
          </span>
          <span>
            <svg width="24" height="8" style="vertical-align:middle">
              <line x1="0" y1="4" x2="24" y2="4" stroke="rgba(120,130,160,0.7)" stroke-width="1.5"/>
            </svg>不顯著
          </span>
          <span style="margin-left:14px;opacity:.7">序列對數：${n.toLocaleString()}</span>`;
      }
      _updateInterpretCard(groupData, _group);
    }
  }

  // ── 白話解讀卡片 ─────────────────────────────────────────────
  function _updateInterpretCard(groupData, group) {
    const cardEl = document.getElementById("lsaInterpretCard");
    if (!cardEl) return;

    const obs   = groupData.observed        ?? {};
    const exp   = groupData.expected        ?? {};
    const z     = groupData.z_score         ?? {};
    const bt    = groupData.behavior_totals ?? {};
    const n     = groupData.n_sequences     ?? 0;
    const total = (bt.M ?? 0) + (bt.Q ?? 0);
    const mPct  = total ? ((bt.M ?? 0) / total * 100).toFixed(1) : "—";
    const qPct  = total ? ((bt.Q ?? 0) / total * 100).toFixed(1) : "—";

    const groupLabel = { all: "全體", pass: "及格組", fail: "不及格組" }[group] || group;

    const zMM  = z["M→M"] ?? 0;
    const oMM  = (obs["M→M"] ?? 0).toLocaleString();
    const oMQ  = (obs["M→Q"] ?? 0).toLocaleString();
    const oQM  = (obs["Q→M"] ?? 0).toLocaleString();
    const oQQ  = (obs["Q→Q"] ?? 0).toLocaleString();
    const eMM  = Math.round(exp["M→M"] ?? 0).toLocaleString();
    const eMQ  = Math.round(exp["M→Q"] ?? 0).toLocaleString();
    const zAbs = Math.abs(zMM).toFixed(1);

    // 及格 vs 不及格比較（只在 all 組顯示）
    let compareHtml = "";
    if (group === "all" && _lsaData?.groups) {
      const zPass = Math.abs(_lsaData.groups.pass?.z_score?.["M→M"] ?? 0).toFixed(1);
      const zFail = Math.abs(_lsaData.groups.fail?.z_score?.["M→M"] ?? 0).toFixed(1);
      compareHtml = `
        <div style="margin-top:10px;padding:10px 12px;background:var(--surface2,#1c2030);border-radius:8px">
          <div style="font-weight:600;color:var(--text,#dde3f5);margin-bottom:4px">📌 及格 vs 不及格比較</div>
          及格組「連續專注」Z = <strong style="color:var(--accent,#3498db)">${zPass}</strong>，
          不及格組 Z = <strong style="color:#e67e22">${zFail}</strong>。<br>
          Z 值差距（${(parseFloat(zPass) - parseFloat(zFail)).toFixed(1)}）反映：
          及格組的<strong style="color:var(--text,#dde3f5)">連續專注行為更為穩定集中</strong>，
          不及格組行為序列相對分散，切換頻率較高。
        </div>`;
    }

    cardEl.innerHTML = `
      <div style="padding:10px 12px;background:var(--surface2,#1c2030);border-radius:8px;margin-bottom:8px">
        <div style="font-weight:600;color:var(--text,#dde3f5);margin-bottom:6px">
          【${groupLabel}】${n.toLocaleString()} 個行為序列對
        </div>
        <div style="margin-bottom:4px">
          ⚡ 行為組成：教材閱讀（M）佔 <strong style="color:var(--accent,#3498db)">${mPct}%</strong>，
          題庫作答（Q）佔 <strong style="color:var(--accent,#3498db)">${qPct}%</strong>
        </div>
        <div>
          📐 本組所有轉移方向的 |Z| 均為 <strong style="color:var(--accent,#3498db)">${zAbs}</strong>
          （遠大於臨界值 1.96）<br>
          <span style="font-size:.75rem;color:var(--text-dim,#888)">
            ※ 2×2 轉移矩陣的數學性質：|Z(M→M)| = |Z(M→Q)| = |Z(Q→M)| = |Z(Q→Q)|，正負號代表偏好或迴避。
          </span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <div style="padding:10px 12px;background:rgba(52,152,219,0.08);border:1px solid rgba(52,152,219,0.2);border-radius:8px">
          <div style="font-weight:600;color:var(--accent,#3498db);margin-bottom:4px">✅ 偏好：連續專注</div>
          <div>M→M 觀察 <strong>${oMM}</strong> 次，期望僅 ${eMM} 次</div>
          <div>Q→Q 觀察 <strong>${oQQ}</strong> 次</div>
          <div style="margin-top:4px;font-size:.75rem">
            白話：學生傾向「一直讀教材」或「一直刷題」，不輕易切換，專注度高。
          </div>
        </div>
        <div style="padding:10px 12px;background:rgba(231,76,60,0.06);border:1px solid rgba(231,76,60,0.2);border-radius:8px">
          <div style="font-weight:600;color:#e67e22;margin-bottom:4px">🚫 迴避：跨行為切換</div>
          <div>M→Q 觀察 <strong>${oMQ}</strong> 次，期望應有 ${eMQ} 次</div>
          <div>Q→M 觀察 <strong>${oQM}</strong> 次</div>
          <div style="margin-top:4px;font-size:.75rem">
            白話：學生極少「讀完教材馬上去做題」或「做完題馬上回去讀材料」，兩種學習模式分開進行。
          </div>
        </div>
      </div>
      ${compareHtml}`;
  }

  // ── Graceful Degradation ──────────────────────────────────────
  function _renderEmptyTo(container, msg) {
    if (!container) return;
    container.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;
                  padding:20px;background:rgba(52,152,219,.04);border:1px solid rgba(52,152,219,.15);
                  border-radius:8px;font-size:.83rem;color:var(--text-dim,#888);text-align:center">
        ⚠️ ${_safeText(msg)}
      </div>`;
  }

  function _renderEmpty(msg) {
    const wrap = document.getElementById("lsaGraphWrap");
    if (wrap) _renderEmptyTo(wrap, msg);
    const legEl = document.getElementById("lsaLegend");
    if (legEl) legEl.innerHTML = "";
  }

  function _safeText(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { init, resetFilters, onGroupChange };
})();
