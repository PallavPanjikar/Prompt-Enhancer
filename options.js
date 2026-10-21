const STORAGE_KEY = "peConfig";

const btnOpenAI = document.getElementById("btn-openai");
const btnAnthropic = document.getElementById("btn-anthropic");
const btnGemini = document.getElementById("btn-gemini");
const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const modelHint = document.getElementById("model-hint");
const saveBtn = document.getElementById("saveBtn");
const status = document.getElementById("status");

let currentProvider = "openai";

const HINTS = {
  openai: "Leave blank to use gpt-4o-mini, or enter any chat-completions model you have access to (check platform.openai.com/docs/models for current names).",
  anthropic: "Leave blank to use Claude Sonnet 5, or enter a specific model string (e.g. claude-opus-4-8, claude-haiku-4-5-20251001).",
  gemini: "Leave blank to use Google's latest Flash model, or enter a specific model string (e.g. gemini-3.5-flash, gemini-3.1-pro). Check aistudio.google.com for current names."
};

const PLACEHOLDERS = {
  openai: "gpt-4o-mini (default)",
  anthropic: "claude-sonnet-5 (default)",
  gemini: "gemini-flash-latest (default)"
};

function setProvider(provider) {
  currentProvider = provider;
  btnOpenAI.classList.toggle("active", provider === "openai");
  btnAnthropic.classList.toggle("active", provider === "anthropic");
  btnGemini.classList.toggle("active", provider === "gemini");
  modelHint.textContent = HINTS[provider];
  modelInput.placeholder = PLACEHOLDERS[provider];
}

btnOpenAI.addEventListener("click", () => setProvider("openai"));
btnAnthropic.addEventListener("click", () => setProvider("anthropic"));
btnGemini.addEventListener("click", () => setProvider("gemini"));

saveBtn.addEventListener("click", () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();
  if (!apiKey) {
    status.style.color = "#ff8fa3";
    status.textContent = "Enter an API key first.";
    return;
  }
  const config = { provider: currentProvider, apiKey, model };
  chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
    status.style.color = "#7de8a4";
    status.textContent = "Saved ✓";
    setTimeout(() => (status.textContent = ""), 2000);
  });
});

// Load existing config
chrome.storage.local.get([STORAGE_KEY], (res) => {
  const config = res[STORAGE_KEY];
  setProvider((config && config.provider) || "openai");
  if (config) {
    apiKeyInput.value = config.apiKey || "";
    modelInput.value = config.model || "";
  }
});
