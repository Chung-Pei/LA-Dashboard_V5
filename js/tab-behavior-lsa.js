/**
 * tab-behavior-lsa.js  —  v16.2
 * LSA 行為序列轉移圖（Lag-1）
 *
 * 資料來源：correlation_matrix.json → lsa_transition
 * 依賴：D3.js v7（<script src> 已在 index.html 無 defer 載入）、behavior-loader.js
 *
 * Graceful degradation：
 *   1. lsa_transition 欄位不存在 → 提示重跑 ETL
 *   2. n_sequences === 0           → 提示無有效序列對
 *   3. D3 未載入                   → catch 後提示載入失敗
 */

const BehaviorLsaTab = (() => {

  let _lsaData = null;   // correlation_matrix.json 的 lsa_transition 欄位
  let _group   = "all";  // "all" | "pass" | "fail"
  let _ro      = null;   // ResizeObserver

  const BEHAVIOR_LABELS = { M: "教材閱讀", Q: "題庫作答" };
  const NODE_BASE_R   = 28;    // 最小節點半徑（px）
  const NODE_SCALE    = 0.012; // sqrt(behavior_total) × scale → 附加半徑（視覺裝飾用，實際增量極小）
  const EDGE_Z_SCALE  = 1.2;   // |Z| × scale → 邊粗細（clamp 1~8）
  const SIG_COLOR     = "var(--accent,#3498db)";
  const INSIG_COLOR   = "rgba(120,130,160,0.4)";
  const NODE_COLOR    = "rgba(52,152,219,0.18)";
  const NODE_STROKE   = "rgba(52,152,219,0.75)";

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
      _render();

      // ResizeObserver：切換 Tab 顯示時自動重繪
      const wrap = document.getElementById("lsaGraphWrap");
      if (wrap && typeof ResizeObserver !== "undefined") {
        _ro = new ResizeObserver(() => {
          const pane = document.getElementById("sub-lsa");
          if (pane && pane.style.display !== "none") _render();
        });
        _ro.observe(wrap);
      }
    } catch (e) {
      console.error("[BehaviorLsaTab] init:", e);
      _renderEmpty(`初始化失敗：${_safeText(String(e?.message ?? e))}`);
    }
  }

  // ── 群組按鈕綁定 ──────────────────────────────────────────────
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

  // ── 重置 ──────────────────────────────────────────────────────
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

    // ── 清除舊 SVG ──
    wrap.innerHTML = "";
    const W = wrap.clientWidth  || 400;
    const H = wrap.clientHeight || 320;

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

    // ── 箭頭 marker 定義 ─────────────────────────────────────────
    const defs = svg.append("defs");

    function _mkMarker(id, color, opacity = 1) {
      defs.append("marker")
        .attr("id", id)
        .attr("viewBox", "0 -5 10 10")
        // BUG-LSA-1 FIX: refX must be >= NODE_BASE_R (28) so arrowhead lands outside circle.
        // Old value of 18 caused arrow to render inside the node.
        .attr("refX", NODE_BASE_R + 2).attr("refY", 0)
        .attr("markerWidth", 6).attr("markerHeight", 6)
        .attr("orient", "auto")
        .append("path")
        .attr("d", "M0,-5L10,0L0,5")
        .attr("fill", color)
        .attr("opacity", opacity);
    }
    _mkMarker("arrow-sig",   SIG_COLOR);
    _mkMarker("arrow-insig", "rgba(120,130,160,0.55)");

    // ── 節點資料 ─────────────────────────────────────────────────
    const behaviors = _lsaData.behaviors ?? ["M", "Q"];
    const totals    = groupData.behavior_totals ?? {};
    const nodes = behaviors.map((b, i) => ({
      id: b,
      label: BEHAVIOR_LABELS[b] || b,
      total: totals[b] ?? 0,
      r: NODE_BASE_R + Math.sqrt(totals[b] ?? 0) * NODE_SCALE,
      x: W * (0.3 + i * 0.4),   // 初始位置
      y: H * 0.5,
    }));

    // ── 邊資料（Lag-1 轉移）────────────────────────────────────────
    const zScores = groupData.z_score    ?? {};
    const sigMap  = groupData.significant ?? {};
    const links = [];
    for (const a of behaviors) {
      for (const b of behaviors) {
        const key = `${a}→${b}`;
        const z   = zScores[key] ?? null;
        const sig = sigMap[key]  ?? false;
        links.push({
          source: a,
          target: b,
          z,
          sig,
          isSelf: a === b,
          width:  z != null ? Math.max(1, Math.min(8, Math.abs(z) * EDGE_Z_SCALE)) : 1,
          color:  sig ? SIG_COLOR : INSIG_COLOR,
          marker: sig ? "url(#arrow-sig)" : "url(#arrow-insig)",
        });
      }
    }

    // ── D3 Force Simulation ───────────────────────────────────────
    const nodeById = new Map(nodes.map(nd => [nd.id, nd]));

    // 設定 links source/target 為 node 物件（D3 force 需要）
    links.forEach(l => {
      l.source = nodeById.get(l.source) ?? l.source;
      l.target = nodeById.get(l.target) ?? l.target;
    });

    const nonSelf = links.filter(l => !l.isSelf);
    const sim = d3.forceSimulation(nodes)
      .force("link",   d3.forceLink(nonSelf).id(d => d.id).distance(W * 0.38).strength(0.6))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide().radius(d => d.r + 20))
      .stop();

    // 靜態迭代（避免動畫 jitter）
    for (let i = 0; i < 200; i++) sim.tick();

    // 邊界 clamp
    nodes.forEach(nd => {
      nd.x = Math.max(nd.r + 4, Math.min(W - nd.r - 4, nd.x));
      nd.y = Math.max(nd.r + 4, Math.min(H - nd.r - 4, nd.y));
    });

    // ── 繪製直向邊（非自環）─────────────────────────────────────
    const edgeG = svg.append("g").attr("class", "lsa-edges");

    // A→B 與 B→A 同時存在時，用曲線 offset 避免重疊
    nonSelf.forEach(l => {
      const sx = l.source.x, sy = l.source.y;
      const tx = l.target.x, ty = l.target.y;
      // 反向邊 offset（曲線中點偏移）
      const dx = tx - sx, dy = ty - sy;
      const norm = Math.sqrt(dx * dx + dy * dy) || 1;
      const cx = (sx + tx) / 2 - dy / norm * 28;
      const cy = (sy + ty) / 2 + dx / norm * 28;

      edgeG.append("path")
        .attr("d", `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`)
        .attr("fill", "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.width)
        .attr("marker-end",   l.marker)
        .attr("opacity", l.sig ? 0.9 : 0.55);

      // Z-score 標籤（僅顯著邊）
      if (l.sig && l.z != null) {
        const lx = (sx + cx * 2 + tx) / 4;
        const ly = (sy + cy * 2 + ty) / 4;
        edgeG.append("text")
          .attr("x", lx).attr("y", ly)
          .attr("text-anchor", "middle")
          .attr("font-size", 9)
          .attr("fill", SIG_COLOR)
          .attr("pointer-events", "none")
          .text(`Z=${l.z >= 0 ? "+" : ""}${l.z.toFixed(2)}`);
      }
    });

    // ── 自環（相同行為連續）────────────────────────────────────
    links.filter(l => l.isSelf).forEach(l => {
      // BUG-LSA-2 FIX: l.source is already a node object after the forEach above.
      const nd = l.source;
      if (!nd) return;
      const rx = nd.r + 8, ry = nd.r * 0.55;
      edgeG.append("ellipse")
        .attr("cx", nd.x).attr("cy", nd.y - nd.r - ry * 0.5)
        .attr("rx", rx).attr("ry", ry)
        .attr("fill", "none")
        .attr("stroke",       l.color)
        .attr("stroke-width", l.width)
        .attr("opacity", l.sig ? 0.9 : 0.45);
      if (l.sig && l.z != null) {
        edgeG.append("text")
          .attr("x", nd.x + rx + 2).attr("y", nd.y - nd.r - ry)
          .attr("font-size", 9).attr("fill", SIG_COLOR)
          .text(`Z=${l.z >= 0 ? "+" : ""}${l.z.toFixed(2)}`);
      }
    });

    // ── 繪製節點 ────────────────────────────────────────────────
    const nodeG = svg.append("g").attr("class", "lsa-nodes");
    nodes.forEach(nd => {
      const g = nodeG.append("g")
        .attr("transform", `translate(${nd.x},${nd.y})`)
        .style("cursor", "default");

      g.append("circle")
        .attr("r", nd.r)
        .attr("fill",         NODE_COLOR)
        .attr("stroke",       NODE_STROKE)
        .attr("stroke-width", 2);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "-0.3em")
        .attr("font-size", 13)
        .attr("font-weight", "bold")
        .attr("fill", "var(--text,#dde3f5)")
        .text(nd.id);

      g.append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "1.1em")
        .attr("font-size", 9)
        .attr("fill", "var(--text-dim,#888)")
        .text(nd.label);

      // tooltip title
      g.append("title")
        .text(`${nd.id}：${nd.label}\n出現次數：${nd.total.toLocaleString()}`);
    });

    // ── 圖例 ────────────────────────────────────────────────────
    const legEl = document.getElementById("lsaLegend");
    if (legEl) {
      legEl.innerHTML = `
        <span style="margin-right:14px">
          <svg width="24" height="8" style="vertical-align:middle">
            <line x1="0" y1="4" x2="24" y2="4" stroke="${SIG_COLOR}" stroke-width="3"/>
          </svg>
          顯著轉移（|Z|&gt;1.96）
        </span>
        <span>
          <svg width="24" height="8" style="vertical-align:middle">
            <line x1="0" y1="4" x2="24" y2="4" stroke="${INSIG_COLOR}" stroke-width="2"/>
          </svg>
          不顯著
        </span>
        <span style="margin-left:14px;opacity:.75">
          序列對數：${n.toLocaleString()}
        </span>`;
    }
  }

  // ── Graceful Degradation ─────────────────────────────────────
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
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  return { init, resetFilters, onGroupChange };
})();
