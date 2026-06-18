(function () {
  "use strict";

  const dynamicClassByStyle = new Map();
  let dynamicClassCount = 0;

  function classForStyleText(styleText) {
    const normalized = styleText.replace(/\s+/g, " ").replace(/\s*;\s*/g, ";").trim();
    if (!dynamicClassByStyle.has(normalized)) {
      dynamicClassCount += 1;
      const className = `csp-dynamic-${dynamicClassCount}`;
      dynamicClassByStyle.set(normalized, className);
      window.installCspCss?.(`dynamic:${className}`, `.${className}{${normalized}}`);
    }
    return dynamicClassByStyle.get(normalized);
  }

  function applyStyleText(el, styleText) {
    if (!el || !styleText) return;
    el.classList.add(classForStyleText(styleText));
    el.removeAttribute("data-csp-style");
  }

  function applyCspStyles(root) {
    if (!root) return;
    if (root.nodeType === Node.ELEMENT_NODE && root.hasAttribute("data-csp-style")) {
      applyStyleText(root, root.getAttribute("data-csp-style"));
    }
    if (root.querySelectorAll) {
      root.querySelectorAll("[data-csp-style]").forEach((el) => {
        applyStyleText(el, el.getAttribute("data-csp-style"));
      });
    }
  }

  window.applyCspStyles = applyCspStyles;

  const installedCss = new Set();

  function topLevelRules(cssText) {
    const rules = [];
    let start = 0;
    let depth = 0;
    for (let i = 0; i < cssText.length; i += 1) {
      const char = cssText[i];
      if (char === "{") depth += 1;
      if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          const rule = cssText.slice(start, i + 1).trim();
          if (rule) rules.push(rule);
          start = i + 1;
        }
      }
    }
    return rules;
  }

  function writableSheet() {
    return Array.from(document.styleSheets).find((sheet) => {
      try {
        return sheet.href && sheet.href.startsWith(location.origin) && sheet.href.endsWith("/style.css") && sheet.cssRules;
      } catch {
        return false;
      }
    });
  }

  window.installCspCss = function installCspCss(id, cssText) {
    if (!id || installedCss.has(id) || !cssText) return;
    const sheet = writableSheet();
    if (!sheet) return;
    topLevelRules(cssText).forEach((rule) => {
      try {
        sheet.insertRule(rule, sheet.cssRules.length);
      } catch (err) {
        console.warn("[CSP CSS] Failed to install rule:", err, rule);
      }
    });
    installedCss.add(id);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => applyCspStyles(document));
  } else {
    applyCspStyles(document);
  }

  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(applyCspStyles);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
