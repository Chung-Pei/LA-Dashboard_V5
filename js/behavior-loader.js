/**
 * behavior-loader.js
 * Phase 2 前端非同步資料載入框架
 * 負責：lazy load JSON、masked_id join、快取管理
 *
 * [v3.0 改善]
 *   BUG-1：無界快取 → 改用容量制 LRU Map（MAX_CACHE=4）
 *   BUG-2：cache:'no-store' 與 Cache Busting 語意衝突 → 移除 no-store
 *   BUG-3：clearCache 不通知 Tab 模組 → 補 resetFilters?.() 通知
 *   WARN-1：joinByMaskedId 全量展開複製 → 僅 behavior 非 null 時展開
 *   新增：_fetchWithGzFallback（gzip → DecompressionStream → plain fallback）
 *   新增：_parseJsonSafe（NaN/Infinity 修正，抽為獨立函式）
 *
 * [v3.1 修正]
 *   BUG-LSA-1：clearCache 遺漏 BehaviorLsaTab 通知 → 補加第四個 fn
 */

const BehaviorLoader = (() => {
  // ── LRU 快取（BUG-1 修正）────────────────────────────────
  const MAX_CACHE = 4;          // 最多快取 4 個 JSON key
  const _lruCache = new Map();  // 保證插入順序（ES2015+）
  const DATA_VERSION = "202606131110"; // [Schema 3.1] by_lsa_type 修正

  function _withCacheBust(url) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${DATA_VERSION}`;
  }

  function _lruGet(key) {
    if (!_lruCache.has(key)) return undefined;
    // 存取時移至末尾（標記為最近使用）
    const val = _lruCache.get(key);
    _lruCache.delete(key);
    _lruCache.set(key, val);
    return val;
  }

  function _lruSet(key, val) {
    if (_lruCache.has(key)) _lruCache.delete(key);
    if (_lruCache.size >= MAX_CACHE) {
      // 淘汰最舊（Map 第一個 key）
      const oldest = _lruCache.keys().next().value;
      _lruCache.delete(oldest);
      console.debug(`[BehaviorLoader] LRU evict: ${oldest}`);
    }
    _lruCache.set(key, val);
  }

  // ── JSON 安全解析（BUG-2 輔助，統一 NaN/Infinity 處理）──
  function _parseJsonSafe(text, url) {
    try {
      return JSON.parse(text);
    } catch (_) {
      const cleaned = text
        .replace(/:\s*(NaN|-?Infinity)(?=\s*[,}])/g, ": null")
        .replace(/([\[,]\s*)(NaN|-?Infinity)(?=\s*[,\]])/g, "$1null");
      try {
        const parsed = JSON.parse(cleaned);
        console.warn(`JSON ${url} contains non-standard NaN/Infinity; converted to null.`);
        return parsed;
      } catch (err) {
        throw new Error(`JSON 解析失敗：${url}（${err.message}）`);
      }
    }
  }

  /**
   * 載入單一 JSON 檔案（BUG-2 修正：移除 cache:'no-store'）
   * 瀏覽器依 Cache Busting query string 判斷是否重取，無需強制 no-store
   */
  async function fetchJSON(key, url) {
    const cached = _lruGet(key);
    if (cached !== undefined) return cached;
    // BUG-2 修正：移除 cache: "no-store"，讓 Cache Busting query string 負責版本控制
    const res = await fetch(_withCacheBust(url));
    if (!res.ok) throw new Error(`載入失敗：${url}（${res.status}）`);
    const text = await res.text();
    const parsed = _parseJsonSafe(text, url);
    _lruSet(key, parsed);
    return parsed;
  }

  /**
   * 優先嘗試 .json.gz，失敗時退至 .json（plain）
   * 方案 A：伺服器送 Content-Encoding:gzip → 瀏覽器自動解壓，直接 res.text()
   * 方案 B：伺服器送裸 .gz（無 Content-Encoding）→ DecompressionStream 手動解壓
   * 方案 C：.gz 不存在或解壓失敗 → 原始 .json fallback
   * 注意：Accept-Encoding 屬瀏覽器 forbidden header，無需手動設定
   */
  async function _fetchWithGzFallback(key, baseUrl) {
    const cached = _lruGet(key);
    if (cached !== undefined) return cached;

    const gzUrl = _withCacheBust(baseUrl + ".gz");

    try {
      const res = await fetch(gzUrl);
      if (res.ok) {
        const contentEncoding = res.headers.get("Content-Encoding");
        let text;
        if (!contentEncoding && typeof DecompressionStream !== "undefined") {
          // 方案 B：手動解壓（Chrome 80+, Firefox 113+, Safari 16.4+）
          const ds = new DecompressionStream("gzip");
          const decompressed = res.body.pipeThrough(ds);
          text = await new Response(decompressed).text();
        } else {
          text = await res.text();
        }
        const parsed = _parseJsonSafe(text, baseUrl);
        _lruSet(key, parsed);
        return parsed;
      }
    } catch (_) { /* 繼續 fallback */ }

    // 方案 C：最終 fallback → 原始 .json
    console.warn(`[BehaviorLoader] gz fallback to plain JSON: ${baseUrl}`);
    return fetchJSON(key, baseUrl);
  }

  // ── 各 JSON 檔的 lazy loader ──────────────────────────────────

  const DATA_ROOT = "data/";   // 相對於 HTML 的 docs/data/ 目錄

  const loaders = {
    // behavior.json 體積最大（5.5MB），優先嘗試 .gz
    behavior:    () => _fetchWithGzFallback("behavior", DATA_ROOT + "behavior.json"),
    radar:       () => fetchJSON("radar",       DATA_ROOT + "radar_chart_data.json"),
    correlation: () => fetchJSON("correlation", DATA_ROOT + "correlation_matrix.json"),
    quiz:        () => fetchJSON("quiz",        DATA_ROOT + "quiz_behavior.json"),
    time:        () => fetchJSON("time",        DATA_ROOT + "time_distribution.json"),
    atRisk:      () => fetchJSON("atRisk",      DATA_ROOT + "at_risk_profile.json"),
  };

  /**
   * 載入行為資料並建立 masked_id → student record 的索引
   */
  async function loadBehaviorData() {
    const data = await loaders.behavior();
    const students = data.students || [];
    const byMaskedId = new Map(
      students.map(s => [s.masked_id, s])
    );
    return { students, byMaskedId, meta: data.meta || {} };
  }

  /**
   * WARN-1 修正：joinByMaskedId 僅在 behavior 非 null 時展開，避免全量複製
   */
  function joinByMaskedId(sourceList, behaviorMap) {
    return sourceList.map(item => {
      const behavior = behaviorMap.get(item.masked_id) ?? null;
      return behavior ? { ...item, behavior } : item;
    });
  }

  // ── 載入狀態管理 ─────────────────────────────────────────

  function setLoading(containerId, show) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.classList.toggle("is-loading", show);
    const overlay = el.querySelector(".loading-overlay");
    if (overlay) overlay.style.display = show ? "flex" : "none";
  }

  function showError(containerId, msg) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="alert alert-warning py-2 px-3 mt-3" role="alert">
        <small>⚠️ 資料載入失敗：${msg}</small>
      </div>`;
  }

  // ── 公開 API ─────────────────────────────────────────────
  return {
    load: loaders,
    loadBehaviorData,
    joinByMaskedId,
    setLoading,
    showError,
    /**
     * BUG-3 修正：clearCache 同步通知四個 Tab 模組重置內部狀態
     * BUG-LSA-1 修正：補加 BehaviorLsaTab（原版遺漏）
     * @param {boolean} notifyTabs 預設 true，傳 false 可靜默清除
     */
    clearCache: (notifyTabs = true) => {
      // 清除所有 key（Map 的 clear 保留物件參照不泄漏）
      _lruCache.clear();
      if (notifyTabs) {
        [
          () => typeof BehaviorRadarTab       !== "undefined" && BehaviorRadarTab.resetFilters?.(),
          () => typeof BehaviorCorrelationTab !== "undefined" && BehaviorCorrelationTab.resetFilters?.(),
          () => typeof BehaviorTimeTab        !== "undefined" && BehaviorTimeTab.resetFilters?.(),
          // BUG-LSA-1 FIX: was missing — LSA tab never received cache-clear notification
          () => typeof BehaviorLsaTab         !== "undefined" && BehaviorLsaTab.resetFilters?.(),
        ].forEach(fn => { try { fn(); } catch (e) { console.warn("[BehaviorLoader.clearCache]", e); } });
      }
    },
  };
})();
