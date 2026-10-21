// ui-core.js — shared flow builder used by popup.js and content.js.
// Exposes window.PromptEnhancerCore.mount(container, opts)

(function () {
  const STORAGE_KEY = "peConfig"; // { provider, apiKey, model }
  const MAX_FILES = 4;
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB per file
  const MAX_TOTAL_SIZE = 15 * 1024 * 1024; // 15MB combined
  const MAX_TEXT_CHARS = 6000; // per text file, to keep prompts sane
  const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json"];

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  }

  function classifyFile(file) {
    const name = file.name.toLowerCase();
    if (IMAGE_TYPES.includes(file.type)) return "image";
    if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
    if (
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      TEXT_EXTENSIONS.some((ext) => name.endsWith(ext))
    ) {
      return "text";
    }
    return "unsupported";
  }

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (res) => resolve(res[STORAGE_KEY] || null));
    });
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        resolve(response);
      });
    });
  }

  function mount(root, opts) {
    opts = opts || {};
    root.innerHTML = "";
    root.classList.add("pe-root");

    const header = el("div", "pe-header");
    const title = el("div", "pe-title", "✨ Prompt Enhancer");
    const settingsBtn = el("button", "pe-icon-btn", "⚙");
    settingsBtn.title = "Settings";
    settingsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());
    header.appendChild(title);
    header.appendChild(settingsBtn);
    if (opts.onClose) {
      const closeBtn = el("button", "pe-icon-btn", "✕");
      closeBtn.title = "Close";
      closeBtn.addEventListener("click", opts.onClose);
      header.appendChild(closeBtn);
    }

    const body = el("div", "pe-body");
    root.appendChild(header);
    root.appendChild(body);

    const state = {
      config: null,
      originalPrompt: "",
      questions: [],
      answers: [],
      finalPrompt: "",
      attachments: [] // { id, name, kind, size, mimeType, dataUrl?, textContent? }
    };

    function showError(container, message) {
      const errBox = el("div", "pe-error", message);
      container.appendChild(errBox);
    }

    function renderSetupNeeded() {
      body.innerHTML = "";
      const msg = el("div", "pe-empty");
      msg.appendChild(el("div", "pe-empty-title", "No API key set up yet"));
      msg.appendChild(el("div", "pe-empty-sub", "Add your OpenAI or Anthropic key to start enhancing prompts."));
      const btn = el("button", "pe-btn pe-btn-primary", "Open Settings");
      btn.addEventListener("click", () => chrome.runtime.openOptionsPage());
      msg.appendChild(btn);
      body.appendChild(msg);
    }

    function currentAttachmentsSize() {
      return state.attachments.reduce((sum, a) => sum + a.size, 0);
    }

    function renderAttachmentList(container, errHolder) {
      container.innerHTML = "";
      if (state.attachments.length === 0) return;
      const list = el("div", "pe-attachments");
      state.attachments.forEach((a) => {
        const chip = el("div", "pe-attachment-chip");
        const icon = a.kind === "image" ? "🖼️" : a.kind === "pdf" ? "📄" : "📝";
        chip.appendChild(el("span", "pe-attachment-icon", icon));
        const nameWrap = el("span", "pe-attachment-name", `${a.name} `);
        nameWrap.appendChild(el("span", "pe-attachment-size", `(${formatSize(a.size)})`));
        chip.appendChild(nameWrap);
        if (a.kind === "pdf" && state.config && state.config.provider === "openai") {
          chip.appendChild(el("span", "pe-attachment-warning", "won't be used by OpenAI"));
        }
        const removeBtn = el("button", "pe-attachment-remove", "✕");
        removeBtn.addEventListener("click", () => {
          state.attachments = state.attachments.filter((x) => x.id !== a.id);
          renderAttachmentList(container, errHolder);
        });
        chip.appendChild(removeBtn);
        list.appendChild(chip);
      });
      container.appendChild(list);
    }

    async function handleFilesSelected(fileList, attachContainer, errHolder) {
      errHolder.innerHTML = "";
      const files = Array.from(fileList);
      for (const file of files) {
        if (state.attachments.length >= MAX_FILES) {
          showError(errHolder, `You can attach up to ${MAX_FILES} files.`);
          break;
        }
        if (file.size > MAX_FILE_SIZE) {
          showError(errHolder, `"${file.name}" is over the ${formatSize(MAX_FILE_SIZE)} limit — skipped.`);
          continue;
        }
        if (currentAttachmentsSize() + file.size > MAX_TOTAL_SIZE) {
          showError(errHolder, `That would exceed the ${formatSize(MAX_TOTAL_SIZE)} total limit — skipped "${file.name}".`);
          continue;
        }
        const kind = classifyFile(file);
        if (kind === "unsupported") {
          showError(errHolder, `"${file.name}" isn't a supported type (images, PDFs, or text/CSV/JSON/MD) — skipped.`);
          continue;
        }
        const item = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.name,
          kind,
          size: file.size,
          mimeType: file.type || (kind === "pdf" ? "application/pdf" : "text/plain")
        };
        try {
          if (kind === "image" || kind === "pdf") {
            item.dataUrl = await readAsDataURL(file);
          } else {
            let text = await readAsText(file);
            if (text.length > MAX_TEXT_CHARS) {
              text = `${text.slice(0, MAX_TEXT_CHARS)}\n...[truncated]`;
            }
            item.textContent = text;
          }
        } catch (e) {
          showError(errHolder, `Couldn't read "${file.name}".`);
          continue;
        }
        state.attachments.push(item);
      }
      renderAttachmentList(attachContainer, errHolder);
    }

    function buildMediaAttachments() {
      return state.attachments
        .filter((a) => a.kind === "image" || a.kind === "pdf")
        .map((a) => ({ name: a.name, kind: a.kind, mimeType: a.mimeType, dataUrl: a.dataUrl }));
    }

    function buildPromptWithTextContext(basePrompt) {
      const textFiles = state.attachments.filter((a) => a.kind === "text");
      if (textFiles.length === 0) return basePrompt;
      const context = textFiles
        .map((a) => `--- Attached file: ${a.name} ---\n${a.textContent}`)
        .join("\n\n");
      return `${basePrompt}\n\n[Additional context from attached files]\n${context}`;
    }

    function renderStepPrompt() {
      body.innerHTML = "";
      const label = el("div", "pe-label", "What do you want an AI to do?");
      const textarea = el("textarea", "pe-textarea");
      textarea.placeholder = "e.g. write a follow-up email to a client who went quiet";
      textarea.value = state.originalPrompt;
      textarea.rows = opts.compact ? 3 : 5;

      const attachRow = el("div", "pe-attach-row");
      const attachBtn = el("button", "pe-btn pe-btn-secondary pe-attach-btn", "📎 Attach files");
      const fileInput = el("input", "pe-file-input");
      fileInput.type = "file";
      fileInput.multiple = true;
      fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,.pdf,application/pdf,.txt,.md,.csv,.json,text/plain,text/csv,application/json";
      fileInput.style.display = "none";
      attachBtn.addEventListener("click", () => fileInput.click());
      attachRow.appendChild(attachBtn);
      attachRow.appendChild(el("span", "pe-attach-hint", "images, PDFs, text/CSV/JSON"));

      const attachContainer = el("div", "pe-attach-container");

      const actions = el("div", "pe-actions");
      const enhanceBtn = el("button", "pe-btn pe-btn-primary", "Enhance ✨");

      const errHolder = el("div", "pe-error-holder");

      fileInput.addEventListener("change", (e) => {
        handleFilesSelected(e.target.files, attachContainer, errHolder);
        fileInput.value = "";
      });

      enhanceBtn.addEventListener("click", async () => {
        const value = textarea.value.trim();
        errHolder.innerHTML = "";
        if (!value) {
          showError(errHolder, "Type a prompt first.");
          return;
        }
        state.originalPrompt = value;
        const promptWithContext = buildPromptWithTextContext(value);
        state.promptForApi = promptWithContext;
        const mediaAttachments = buildMediaAttachments();
        state.mediaAttachments = mediaAttachments;
        renderLoading("Reading your prompt and thinking of good questions…");
        const res = await sendMessage({
          action: "generateQuestions",
          prompt: promptWithContext,
          attachments: mediaAttachments,
          config: state.config
        });
        if (!res || !res.ok) {
          renderStepPrompt();
          showError(body, (res && res.error) || "Something went wrong.");
          return;
        }
        state.questions = res.questions || [];
        state.answers = state.questions.map(() => "");
        if (state.questions.length === 0) {
          // Nothing to ask — go straight to synthesis.
          runSynthesis();
        } else {
          renderStepQuestions();
        }
      });

      actions.appendChild(enhanceBtn);
      body.appendChild(label);
      body.appendChild(textarea);
      body.appendChild(attachRow);
      body.appendChild(attachContainer);
      body.appendChild(actions);
      body.appendChild(errHolder);
      renderAttachmentList(attachContainer, errHolder);
      textarea.focus();
    }

    function renderLoading(message) {
      body.innerHTML = "";
      const wrap = el("div", "pe-loading");
      wrap.appendChild(el("div", "pe-spinner"));
      wrap.appendChild(el("div", "pe-loading-text", message));
      body.appendChild(wrap);
    }

    function renderStepQuestions() {
      body.innerHTML = "";
      const label = el("div", "pe-label", "A few quick questions (skip any that don't apply):");
      body.appendChild(label);

      const list = el("div", "pe-questions");
      state.questions.forEach((q, i) => {
        const qWrap = el("div", "pe-question");
        qWrap.appendChild(el("div", "pe-question-text", q));
        const input = el("textarea", "pe-textarea pe-textarea-sm");
        input.rows = 2;
        input.value = state.answers[i] || "";
        input.addEventListener("input", () => {
          state.answers[i] = input.value;
        });
        qWrap.appendChild(input);
        list.appendChild(qWrap);
      });
      body.appendChild(list);

      const errHolder = el("div", "pe-error-holder");
      body.appendChild(errHolder);

      const actions = el("div", "pe-actions");
      const backBtn = el("button", "pe-btn pe-btn-secondary", "Back");
      backBtn.addEventListener("click", renderStepPrompt);
      const genBtn = el("button", "pe-btn pe-btn-primary", "Generate final prompt ✨");
      genBtn.addEventListener("click", runSynthesis);
      actions.appendChild(backBtn);
      actions.appendChild(genBtn);
      body.appendChild(actions);
    }

    async function runSynthesis() {
      renderLoading("Weaving your answers into one clean prompt…");
      const qna = state.questions.map((q, i) => ({ question: q, answer: state.answers[i] || "" }));
      const res = await sendMessage({
        action: "generateFinalPrompt",
        prompt: state.promptForApi || state.originalPrompt,
        qna,
        attachments: state.mediaAttachments || [],
        config: state.config
      });
      if (!res || !res.ok) {
        if (state.questions.length > 0) {
          renderStepQuestions();
        } else {
          renderStepPrompt();
        }
        showError(body, (res && res.error) || "Something went wrong.");
        return;
      }
      state.finalPrompt = res.finalPrompt || "";
      renderStepResult();
    }

    function renderStepResult() {
      body.innerHTML = "";
      const label = el("div", "pe-label", "Your optimized prompt:");
      const textarea = el("textarea", "pe-textarea pe-result");
      textarea.readOnly = true;
      textarea.value = state.finalPrompt;
      textarea.rows = opts.compact ? 6 : 9;

      const actions = el("div", "pe-actions");
      const copyBtn = el("button", "pe-btn pe-btn-primary", "Copy");
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(state.finalPrompt);
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
        } catch (e) {
          textarea.select();
          document.execCommand("copy");
          copyBtn.textContent = "Copied ✓";
          setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
        }
      });
      const restartBtn = el("button", "pe-btn pe-btn-secondary", "Start over");
      restartBtn.addEventListener("click", () => {
        state.originalPrompt = "";
        state.promptForApi = "";
        state.questions = [];
        state.answers = [];
        state.finalPrompt = "";
        state.attachments = [];
        state.mediaAttachments = [];
        renderStepPrompt();
      });

      actions.appendChild(restartBtn);
      actions.appendChild(copyBtn);
      body.appendChild(label);
      body.appendChild(textarea);
      body.appendChild(actions);
    }

    // Init
    getConfig().then((config) => {
      state.config = config;
      if (!config || !config.apiKey) {
        renderSetupNeeded();
      } else {
        renderStepPrompt();
        if (opts.initialPrompt) {
          const ta = body.querySelector("textarea");
          if (ta) ta.value = opts.initialPrompt;
        }
      }
    });

    // Allow external refresh (e.g. after saving settings in another tab)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[STORAGE_KEY]) {
        getConfig().then((config) => {
          state.config = config;
          if (!body.querySelector(".pe-question, .pe-result")) {
            // Only auto-refresh if user hasn't progressed into the flow.
            if (!config || !config.apiKey) {
              renderSetupNeeded();
            } else if (body.querySelector(".pe-empty")) {
              renderStepPrompt();
            }
          }
        });
      }
    });
  }

  window.PromptEnhancerCore = { mount };
})();
