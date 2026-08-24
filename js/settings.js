/**
 * Client-side settings: the Gemini API key (and optional model override)
 * used by js/gemini-api.js for voice-challenge transcription/evaluation.
 * Persisted to localStorage only — this is a static site with no backend,
 * so the key never touches any server of ours; it goes straight from this
 * browser to Google on each request (see the modal's own warning text).
 */
(function (global) {
  "use strict";

  const KEY_STORAGE = "vhf_sim_gemini_api_key";
  const MODEL_STORAGE = "vhf_sim_gemini_model";
  const DEFAULT_MODEL = "gemini-flash-latest";

  function getApiKey() {
    try {
      return localStorage.getItem(KEY_STORAGE) || "";
    } catch (e) {
      return "";
    }
  }
  function setApiKey(key) {
    try {
      if (key) localStorage.setItem(KEY_STORAGE, key);
      else localStorage.removeItem(KEY_STORAGE);
    } catch (e) {
      /* localStorage unavailable (private mode etc.) — key just won't persist */
    }
  }
  function getModel() {
    try {
      return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
    } catch (e) {
      return DEFAULT_MODEL;
    }
  }
  function setModel(model) {
    try {
      if (model) localStorage.setItem(MODEL_STORAGE, model);
      else localStorage.removeItem(MODEL_STORAGE);
    } catch (e) {
      /* ignore */
    }
  }
  function hasApiKey() {
    return getApiKey().trim().length > 0;
  }

  global.simSettings = { getApiKey, setApiKey, getModel, setModel, hasApiKey, DEFAULT_MODEL };

  // ---------------------------------------------------------------- modal UI
  function initSettingsUI() {
    const openBtn = document.getElementById("settings-open-btn");
    const backdrop = document.getElementById("settings-backdrop");
    const modal = document.getElementById("settings-modal");
    const keyInput = document.getElementById("settings-api-key");
    const showKeyBox = document.getElementById("settings-show-key");
    const modelInput = document.getElementById("settings-model");
    const saveBtn = document.getElementById("settings-save-btn");
    const cancelBtn = document.getElementById("settings-cancel-btn");
    const clearBtn = document.getElementById("settings-clear-btn");
    if (!openBtn || !backdrop) return;

    function open() {
      keyInput.value = getApiKey();
      modelInput.value = getModel() === DEFAULT_MODEL ? "" : getModel();
      showKeyBox.checked = false;
      keyInput.type = "password";
      backdrop.hidden = false;
      updateOpenBtnLabel();
    }
    function close() {
      backdrop.hidden = true;
    }
    function updateOpenBtnLabel() {
      openBtn.classList.toggle("has-key", hasApiKey());
    }

    openBtn.addEventListener("click", open);
    cancelBtn.addEventListener("click", close);
    backdrop.addEventListener("click", (evt) => {
      if (evt.target === backdrop) close();
    });
    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && !backdrop.hidden) close();
    });
    showKeyBox.addEventListener("change", () => {
      keyInput.type = showKeyBox.checked ? "text" : "password";
    });
    saveBtn.addEventListener("click", () => {
      setApiKey(keyInput.value.trim());
      setModel(modelInput.value.trim());
      updateOpenBtnLabel();
      close();
      if (global.simToast) global.simToast(hasApiKey() ? "Gemini API-Schlüssel gespeichert." : "Kein Schlüssel gespeichert.");
    });
    clearBtn.addEventListener("click", () => {
      setApiKey("");
      keyInput.value = "";
      updateOpenBtnLabel();
      if (global.simToast) global.simToast("API-Schlüssel gelöscht.");
    });

    updateOpenBtnLabel();
  }

  global.initSettingsUI = initSettingsUI;
})(window);
