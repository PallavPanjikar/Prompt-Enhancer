(function () {
  if (window.__promptEnhancerInjected) return;
  window.__promptEnhancerInjected = true;

  const EXT_URL = chrome.runtime.getURL("");

  const hostDiv = document.createElement("div");
  hostDiv.id = "pe-shadow-host";
  const shadow = hostDiv.attachShadow({ mode: "open" });

  const linkShared = document.createElement("link");
  linkShared.rel = "stylesheet";
  linkShared.href = chrome.runtime.getURL("shared.css");
  const linkPanel = document.createElement("link");
  linkPanel.rel = "stylesheet";
  linkPanel.href = chrome.runtime.getURL("content-panel.css");
  shadow.appendChild(linkShared);
  shadow.appendChild(linkPanel);

  const trigger = document.createElement("button");
  trigger.className = "pe-trigger";
  trigger.type = "button";
  trigger.textContent = "✨";
  trigger.style.display = "none";
  shadow.appendChild(trigger);

  let panelEl = null;
  let backdropEl = null;
  let activeField = null;
  let hideTimer = null;
  let panelOpen = false;

  function onReady() {
    document.documentElement.appendChild(hostDiv);
  }
  if (document.body) onReady();
  else document.addEventListener("DOMContentLoaded", onReady);

  function isEligible(node) {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName.toLowerCase();
    if (tag === "textarea") return true;
    if (tag === "input") {
      const type = (node.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url"].includes(type);
    }
    if (node.isContentEditable) return true;
    return false;
  }

  function getFieldValue(node) {
    if (!node) return "";
    const tag = node.tagName.toLowerCase();
    if (tag === "textarea" || tag === "input") return node.value || "";
    if (node.isContentEditable) return node.innerText || "";
    return "";
  }

  function positionTrigger(field) {
    const rect = field.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const top = Math.max(8, rect.top + 6);
    const left = Math.min(window.innerWidth - 38, rect.right - 36);
    trigger.style.top = `${top}px`;
    trigger.style.left = `${left}px`;
    return true;
  }

  function showTrigger(field) {
    activeField = field;
    if (positionTrigger(field) === false) return;
    trigger.style.display = "flex";
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!panelOpen) {
        trigger.style.display = "none";
        activeField = null;
      }
    }, 180);
  }

  document.addEventListener(
    "focusin",
    (e) => {
      if (isEligible(e.target)) {
        clearTimeout(hideTimer);
        showTrigger(e.target);
      }
    },
    true
  );

  document.addEventListener(
    "focusout",
    () => {
      scheduleHide();
    },
    true
  );

  window.addEventListener(
    "scroll",
    () => {
      if (activeField && trigger.style.display !== "none") {
        positionTrigger(activeField);
      }
    },
    true
  );
  window.addEventListener("resize", () => {
    if (activeField && trigger.style.display !== "none") {
      positionTrigger(activeField);
    }
  });

  function openPanel() {
    if (panelOpen) return;
    panelOpen = true;
    clearTimeout(hideTimer);

    const fieldForPrompt = activeField;
    const initialPrompt = getFieldValue(fieldForPrompt);

    backdropEl = document.createElement("div");
    backdropEl.className = "pe-panel-backdrop";
    backdropEl.addEventListener("click", closePanel);
    shadow.appendChild(backdropEl);

    panelEl = document.createElement("div");
    panelEl.className = "pe-panel";
    shadow.appendChild(panelEl);

    const triggerRect = trigger.getBoundingClientRect();
    const panelWidth = 360;
    let left = triggerRect.right - panelWidth;
    left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
    let top = triggerRect.bottom + 8;
    if (top + 400 > window.innerHeight) {
      top = Math.max(8, triggerRect.top - 460);
    }
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;

    window.PromptEnhancerCore.mount(panelEl, {
      compact: true,
      initialPrompt,
      onClose: closePanel
    });
  }

  function closePanel() {
    panelOpen = false;
    if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
    if (backdropEl) {
      backdropEl.remove();
      backdropEl = null;
    }
    scheduleHide();
  }

  trigger.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (panelOpen) {
      closePanel();
    } else {
      openPanel();
    }
  });
})();
