/**
 * tab-behavior-lsa.js  —  v16.4
 * LSA 行為序列轉移圖（Lag-1）
 *
 * v16.3 FIX：副標題放大、?說明按鈕、視覺優化、放大 overlay
 * v16.4 修正（systematic-debug）：
 *   BUG-A: HELP_HTML inline onclick 違反 CSP script-src 'self'
 *          → 改為 JS addEventListener 動態綁定，移除所有 onclick 屬性
 *   BUG-B: _mkMarker refX=NODE_BASE_R+2=24 超出 viewBox(0-10) 座標空間
 *          → refX 應設為箭頭路徑尖端座標 10，並在路徑終點前退 nodeR px
 *          → 正確做法：path 終點縮短 nodeR，refX 設為路徑尖端(10)
 *          → 簡化：refX=10（marker viewBox 內尖端），由路徑長度控制距離
 *   BUG-E: _bindHelpButton / _bindExpandButton 多次 init() 時重複綁定
 *          → 綁定前 cloneNode 置換按鈕，清除舊 listener
 *   BUG-G: ResizeObserver 在 clientWidth<10 時觸發渲染，產生無效 SVG
 *          → 加 guard: if (wrap.clientWidth < 10) return
 */

const BehaviorLsaTab = (() => {

  let _lsaData = null;
  let _group   = "all";
  let _ro      = null;

  const BEHAVIOR_LABELS = { M: "教材閱讀", Q: "題庫作答" };
  const NODE_BASE_R  = 22;
  const NODE_SCALE   = 0.008;
  const EDGE_Z_SCALE = 0.55;
  const SIG_COLOR    = "var(--accent,#3498db)";
  const INSIG_COLOR  = "rgba(120,130,160,0.35)";
  const NODE_COLOR   = "rgba(52,152,219,0.15)";
  const NODE_STROKE  = "rgba(52,152,219,0.7)";

  // ── 初始化 ────────────────────────────────────────────────────
  async function init() {
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
      _group   = "all";
      _syncGroupBtnStyles();
      _bindGroupButtons();
      _bindHelpButton();
      _bindExpandButton();
      _render();

      // BUG-G FIX: guard clientWidth < 10 避免初始化時觸發無效渲染
      const wrap = document.getElementById("lsaGraphWrap");
      if (wrap && typeof ResizeObserver !== "undefined") {
        if (_ro) _ro.disconnect();
        _ro = new ResizeObserver(() => {
          const pane = document.getElementById("sub-lsa");
          if (!pane || pane.style.display === "none") return;
          const w = document.getElementById("lsaGraphWrap");
          if (!w || w.clientWidth < 10) return;  // BUG-G FIX
          _render();
        });
        _ro.observe(wrap);
      }
    } catch (e) {
      console.error("[BehaviorLsaTab] init:", e);
      _renderEmpty(`初始化失敗：${_safeText(String(e?.message ?? e))}`);
    }
  }

  // ── BUG-E FIX：cloneNode 置換按鈕清除舊 listener ─────────────
  function _freshBtn(id) {
    const btn = document.getElementById(id);
    if (!btn) return null;
    const clone = btn.cloneNode(true);
    btn.parentNode.replaceChild(clone, btn);
    return clone;
  }

  // ── Help 按鈕（BUG-A FIX：所有互動改為 addEventListener）──────
  function _bindHelpButton() {
    const btn = _freshBtn("lsaHelpBtn");
    if (!btn) return;
    btn.addEventListener("click", _showHelpModal);
  }

  function _showHelpModal() {
    if (document.getElementById("lsaHelpOverlay")) return;

    // BUG-A FIX: 不使用 innerHTML onclick，改用 createElement + addEventListener
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

    // 標題列
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

    // 說明內容（純 DOM，無 inline script）
    panel.insertAdjacentHTML("beforeend", `
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">📌 什麼是滯後序列分析（LSA）？</div>
      <p style="color:var(--text-dim,#aaa);margin:0 0 14px">
        滯後序列分析（Lag-Sequential Analysis）用於分析<strong>行為之間的接續模式</strong>。
        本圖呈現學生完成某一行為後，接下來最可能執行哪種行為（Lag-1 = 緊接的下一個行為）。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">🔢 Z-score 怎麼算？</div>
      <div style="background:var(--surface2,#1c2030);border-radius:8px;padding:12px 14px;font-family:monospace;font-size:.82rem;color:#9de8b8;margin-bottom:14px">
        Z = (觀察次數 − 期望次數) / √期望次數<br><br>
        期望次數 = P(行為B出現) × A 出現後的總轉移次數
      </div>
      <p style="color:var(--text-dim,#aaa);margin:0 0 14px">
        Z-score &gt;+1.96 代表 A→B 的轉移<strong>顯著多於隨機預期</strong>；
        Z-score &lt;−1.96 代表顯著迴避此轉移。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">🔵 節點（圓圈）</div>
      <p style="color:var(--text-dim,#aaa);margin:0 0 14px">
        每個節點代表一種學習行為（M=教材閱讀、Q=題庫作答）。
        節點大小反映該行為的<strong>出現總次數</strong>。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">➡ 邊線（箭頭）</div>
      <p style="color:var(--text-dim,#aaa);margin:0 0 14px">
        <span style="color:#3498db;font-weight:600">藍色粗線</span>：顯著轉移（|Z|&gt;1.96，p&lt;0.05）<br>
        <span style="color:rgba(120,130,160,0.9);font-weight:600">灰色細線</span>：不顯著轉移<br>
        自環（橢圓箭頭）代表<strong>連續重複相同行為</strong>。
      </p>
      <div style="font-weight:700;color:var(--text,#dde3f5);margin-bottom:4px">👥 三組篩選</div>
      <p style="color:var(--text-dim,#aaa);margin:0">
        全體 / 及格組 / 不及格組 — 比較不同學習成效學生的行為序列差異，
        有助於辨識高效與低效的學習模式。
      </p>`);

    overlay.appendChild(panel);
    // BUG-A FIX: 背景點擊關閉改為 addEventListener，不用 onclick 屬性
    overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  }

  // ── 放大按鈕 ─────────────────────────────────────────────────
  function _bindExpandButton() {
    const btn = _freshBtn("lsaExpandBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const wrap = document.getElementById("lsaGraphWrap");
      if (!wrap) return;
      const svgEl = wrap.querySelector("svg");
      if (!svgEl) return;

      const existing = document.getElementById("lsaExpandOverlay");
      if (existing) { existing.remove(); return; }

      // cloneNode(true) 會複製 defs（含 marker），overlay 內 url(#id) 引用有效
      const svgClone = svgEl.cloneNode(true);
      svgClone.setAttribute("width",  "100%");
      svgClone.setAttribute("height", "100%");
      svgClone.style.cssText = "max-width:100%;max-height:100%";

      const overlay = document.createElement("div");
      overlay.id = "lsaExpandOverlay";
      Object.assign(overlay.style, {
        position: "fixed", inset: "0", zIndex: "9998",
        background: "rgba(10,13,22,0.93)",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        padding: "20px", boxSizing: "border-box",
      });

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✕ 關閉";
      Object.assign(closeBtn.style, {
        position: "absolute", top: "16px", right: "20px",
        background: "var(--surface2,#1c2030)",
        border: "1px solid var(--border2,#2a2f45)",
        borderRadius: "20px", color: "var(--text-dim,#aaa)",
        padding: "6px 16px", cursor: "pointer",
        fontSize: ".85rem", zIndex: "1",
      });
      closeBtn.addEventListener("click", () => overlay.remove());

      const svgWrap = document.createElement("div");
      Object.assign(svgWrap.style, {
        width: "90vw", height: "80vh",
        display: "flex", alignItems: "center", justifyContent: "center",
      });
      svgWrap.appendChild(svgClone);

      overlay.appendChild(closeBtn);
      overlay.appendChild(svgWrap);
      overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
      document.body.appendChild(overlay);
    });
  }

  // ── 群組按鈕 ──────────────────────────────────────────────────
  function _bindGroupButtons() {
    document.querySelectorAll("#lsaGroupControls .lsa-group-btn").forEach(btn => {
      btn.addEventListener("click", () => onGroupChange(btn.dataset.group));
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
    _group = "all";
    _syncGroupBtnStyles();
    if (_lsaData) _render();
  }

  // ── 主渲染 ────────────────────────────────────────────────────
  function _render() {
    const wrap = document.getElementById("lsaGraphWrap");
    if (!wrap) return;
    if (!_lsaData) { _renderEmpty("資料尚未載入"); return; }

    const groupData = _lsaData.groups?.[_group];
    if (!groupData) { _renderEmpty(`找不到群組 ${_group} 的資料`); return; }

    const n = groupData.n_sequences ?? 0;
    if (n === 0) {
      _renderEmpty("本批資料無有效行為序列對（reading_log 可能為空）");
      return;
    }

    wrap.innerHTML = "";
    const W = wrap.clientWidth  || 480;
    const H = wrap.clientHeight || 340;

    let svg;
    try {
      svg = d3.select(wrap).append("svg")
        .attr("width",  "100%")
        .attr("height", "100%")
        .attr("viewBox", `0 0 ${W} ${H}`)
        .style("font-family", "sans-serif");
    } catch (e) {
      _renderEmpty("D3.js 載入失敗，請確認網路連線。");
      return;
    }

    // ── 箭頭 marker ───────────────────────────────────────────────
    // BUG-B FIX: refX=10 對應 viewBox "0 -5 10 10" 的路徑尖端座標
    // 路徑終點與節點邊緣的距離由 path 的實際座標控制（非 refX）
    const defs = svg.append("defs");
    function _mkMarker(id, color, size) {
      defs.append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -5 10 10")
        .attr("refX", 10)   // BUG-B FIX: 箭頭尖端在 viewBox x=10
        .attr("refY", 0)
        .attr("markerWidth",  size)
        .attr("markerHeight", size)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color);
    }
    _mkMarker("arrow-sig",   SIG_COLOR,              5);
    _mkMarker("arrow-insig", "rgba(120,130,160,0.6)", 4);

    // ── 節點資料 ──────────────────────────────────────────────────
    const behaviors = _lsaData.behaviors ?? ["M", "Q"];
    const totals    = groupData.behavior_totals ?? {};
    const nodes = behaviors.map((b, i) => ({
      id:    b,
      label: BEHAVIOR_LABELS[b] || b,
      total: totals[b] ?? 0,
      r:     NODE_BASE_R + Math.sqrt(totals[b] ?? 0) * NODE_SCALE,
      x:     W * (0.28 + i * 0.44),
      y:     H * 0.5,
    }));

    // ── 邊資料 ────────────────────────────────────────────────────
    const zScores = groupData.z_score    ?? {};
    const sigMap  = groupData.significant ?? {};
    const links = [];
    for (const a of behaviors) {
      for (const b of behaviors) {
        const key = `${a}→${b}`;
        const z   = zScores[key] ?? null;
        const sig = sigMap[key]  ?? false;
        links.push({
          source: a, target: b, z, sig,
          isSelf: a === b,
          width:  z != null ? Math.max(0.8, Math.min(4, Math.abs(z) * EDGE_Z_SCALE)) : 0.8,
          color:  sig ? SIG_COLOR : INSIG_COLOR,
          marker: sig ? "url(#arrow-sig)" : "url(#arrow-insig)",
        });
      }
    }

    // ── D3 Force Simulation ───────────────────────────────────────
    const nodeById = new Map(nodes.map(nd => [nd.id, nd]));
    links.forEach(l => {
      l.source = nodeById.get(l.source) ?? l.source;
      l.target = nodeById.get(l.target) ?? l.target;
    });

    const nonSelf = links.filter(l => !l.isSelf);
    const sim = d3.forceSimulation(nodes)
      .force("link",      d3.forceLink(nonSelf).id(d => d.id).distance(W * 0.4).strength(0.6))
      .force("charge",    d3.forceManyBody().strength(-100))
      .force("center",    d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide().radius(d => d.r + 24))
      .stop();
    for (let i = 0; i < 200; i++) sim.tick();
    nodes.forEach(nd => {
      nd.x = Math.max(nd.r + 8, Math.min(W - nd.r - 8, nd.x));
      nd.y = Math.max(nd.r + 8, Math.min(H - nd.r - 8, nd.y));
    });

    // ── 邊線 ──────────────────────────────────────────────────────
    const edgeG = svg.append("g").attr("class", "lsa-edges");

    nonSelf.forEach(l => {
      const sx = l.source.x, sy = l.source.y;
      const tx = l.target.x, ty = l.target.y;
      const dx = tx - sx, dy = ty - sy;
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;

      // 雙向邊曲線偏移，避免重疊
      const cx = (sx + tx) / 2 - dy / norm * 22;
      const cy = (sy + ty) / 2 + dx / norm * 22;

      // BUG-B FIX: 路徑終點縮短 nodeR，讓箭頭落在節點邊緣外側
      // 計算從終點沿方向向量退 nd.r px 的點
      const ndT  = l.target;
      const qDx  = tx - cx, qDy = ty - cy;
      const qLen = Math.sqrt(qDx * qDx + qDy * qDy) || 1;
      const ex   = tx - (qDx / qLen) * ndT.r;
      const ey   = ty - (qDy / qLen) * ndT.r;

      edgeG.append("path")
        .attr("d", `M${sx},${sy} Q${cx},${cy} ${ex},${ey}`)
        .attr("fill",         "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.width)
        .attr("marker-end",   l.marker)
        .attr("opacity",      l.sig ? 0.85 : 0.45);

      // Z-score pill badge
      if (l.sig && l.z != null) {
        const lx    = (sx + cx * 2 + tx) / 4;
        const ly    = (sy + cy * 2 + ty) / 4;
        const label = `Z ${l.z >= 0 ? "+" : ""}${l.z.toFixed(1)}`;
        // BUG-C 改善：用保守估算確保不截字
        const bw = Math.max(42, label.length * 5.5 + 12);
        const bh = 16;
        edgeG.append("rect")
          .attr("x", lx - bw / 2).attr("y", ly - bh / 2)
          .attr("width", bw).attr("height", bh)
          .attr("rx", 8).attr("ry", 8)
          .attr("fill",         "var(--surface,#13161f)")
          .attr("stroke",       SIG_COLOR)
          .attr("stroke-width", 1)
          .attr("opacity",      0.93);
        edgeG.append("text")
          .attr("x", lx).attr("y", ly)
          .attr("text-anchor",      "middle")
          .attr("dominant-baseline","central")
          .attr("font-size",   9)
          .attr("font-weight", "600")
          .attr("fill",        SIG_COLOR)
          .attr("pointer-events", "none")
          .text(label);
      }
    });

    // ── 自環 ──────────────────────────────────────────────────────
    links.filter(l => l.isSelf).forEach(l => {
      const nd = l.source;
      if (!nd) return;
      const rx = nd.r + 6, ry = nd.r * 0.5;
      edgeG.append("ellipse")
        .attr("cx", nd.x).attr("cy", nd.y - nd.r - ry * 0.5)
        .attr("rx", rx).attr("ry", ry)
        .attr("fill",         "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.width)
        .attr("opacity",      l.sig ? 0.85 : 0.4);
      if (l.sig && l.z != null) {
        const label = `Z ${l.z >= 0 ? "+" : ""}${l.z.toFixed(1)}`;
        const lx = nd.x + rx + 4;
        const ly = nd.y - nd.r - ry;
        const bw = Math.max(42, label.length * 5.5 + 12);
        edgeG.append("rect")
          .attr("x", lx).attr("y", ly - 8)
          .attr("width", bw).attr("height", 16)
          .attr("rx", 8)
          .attr("fill",         "var(--surface,#13161f)")
          .attr("stroke",       SIG_COLOR)
          .attr("stroke-width", 1)
          .attr("opacity",      0.93);
        edgeG.append("text")
          .attr("x", lx + bw / 2).attr("y", ly)
          .attr("text-anchor",       "middle")
          .attr("dominant-baseline", "central")
          .attr("font-size",   9)
          .attr("font-weight", "600")
          .attr("fill",        SIG_COLOR)
          .text(label);
      }
    });

    // ── 節點 ──────────────────────────────────────────────────────
    const nodeG = svg.append("g").attr("class", "lsa-nodes");
    nodes.forEach(nd => {
      const g = nodeG.append("g")
        .attr("transform", `translate(${nd.x},${nd.y})`)
        .style("cursor", "default");

      g.append("circle")
        .attr("r",            nd.r)
        .attr("fill",         NODE_COLOR)
        .attr("stroke",       NODE_STROKE)
        .attr("stroke-width", 1.5);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.25em")
        .attr("font-size",   15)
        .attr("font-weight", "bold")
        .attr("fill",        "var(--text,#dde3f5)")
        .text(nd.id);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy",        "1.2em")
        .attr("font-size", 10)
        .attr("fill",      "var(--text-mid,#9aa0b8)")
        .text(nd.label);

      g.append("title")
        .text(`${nd.id}：${nd.label}\n出現次數：${nd.total.toLocaleString()}`);
    });

    // ── 圖例 ──────────────────────────────────────────────────────
    const legEl = document.getElementById("lsaLegend");
    if (legEl) {
      legEl.innerHTML = `
        <span style="margin-right:14px">
          <svg width="24" height="8" style="vertical-align:middle">
            <line x1="0" y1="4" x2="24" y2="4" stroke="${SIG_COLOR}" stroke-width="2.5"/>
          </svg>
          顯著轉移（|Z|&gt;1.96）
        </span>
        <span>
          <svg width="24" height="8" style="vertical-align:middle">
            <line x1="0" y1="4" x2="24" y2="4" stroke="rgba(120,130,160,0.7)" stroke-width="1.5"/>
          </svg>
          不顯著
        </span>
        <span style="margin-left:14px;opacity:.7">序列對數：${n.toLocaleString()}</span>`;
    }
  }

  // ── Graceful Degradation ──────────────────────────────────────
  function _renderEmpty(msg) {
    const wrap = document.getElementById("lsaGraphWrap");
    if (!wrap) return;
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;height:100%;
                  padding:20px;background:rgba(52,152,219,.04);border:1px solid rgba(52,152,219,.15);
                  border-radius:8px;font-size:.83rem;color:var(--text-dim,#888);text-align:center">
        ⚠️ ${_safeText(msg)}
      </div>`;
    const legEl = document.getElementById("lsaLegend");
    if (legEl) legEl.innerHTML = "";
  }

  function _safeText(s) {
    return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { init, resetFilters, onGroupChange };
})();
