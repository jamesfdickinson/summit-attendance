(function () {
  "use strict";

  const STORAGE_KEY = "summit-check-in-family";
  const FAMILY_DATA_STORAGE_KEY = "summit-check-in-families-v1";
  const DEMO_STORAGE_KEY = "summit-check-in-demo-records";
  const config = window.SUMMIT_CONFIG || {};
  const endpoint = String(config.API_URL || "").trim();
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const hasEndpoint = /^https:\/\/script\.google\.com\/.+\/exec(?:\?.*)?$/i.test(endpoint);

  const elements = {
    formPage: document.getElementById("form-page"),
    install: document.getElementById("install-button"),
    form: document.getElementById("check-in-form"),
    family: document.getElementById("family-select"),
    membersField: document.getElementById("members-field"),
    memberGrid: document.getElementById("member-grid"),
    notesField: document.getElementById("notes-field"),
    notes: document.getElementById("notes"),
    notesCount: document.getElementById("notes-count"),
    loadingStatus: document.getElementById("loading-status"),
    loadingText: document.getElementById("loading-text"),
    setupNotice: document.getElementById("setup-notice"),
    errorNotice: document.getElementById("error-notice"),
    errorMessage: document.getElementById("error-message"),
    retry: document.getElementById("retry-button"),
    actionBar: document.getElementById("action-bar"),
    submit: document.getElementById("submit-button"),
    submitLabel: document.querySelector("#submit-button .button-label"),
    successPage: document.getElementById("success-page"),
    successFamily: document.getElementById("success-family"),
    successMembers: document.getElementById("success-members"),
    anotherFamily: document.getElementById("another-family-button")
  };

  const state = {
    families: new Map(),
    record: null,
    loadingFamily: false,
    saving: false
  };

  let deferredInstallPrompt = null;
  let resetConfirmationOnResume = false;

  const demoFamilies = [
    { name: "Dickinson, L", members: ["Lisa", "Abby", "Noah", "Hannah", "Andrew"] },
    { name: "Garcia", members: ["Elena", "Mateo", "Sofia"] },
    { name: "Williams", members: ["Jordan", "Taylor"] }
  ];

  const api = isDemo ? createDemoApi() : createLiveApi();

  function createLiveApi() {
    async function request(action, options) {
      if (!hasEndpoint) {
        throw new Error("The Google Apps Script URL has not been configured yet.");
      }

      const requestOptions = options || {};
      let url = endpoint;
      const fetchOptions = {
        method: requestOptions.method || "GET",
        cache: "no-store",
        redirect: "follow"
      };

      if (fetchOptions.method === "POST") {
        fetchOptions.headers = { "Content-Type": "text/plain;charset=utf-8" };
        fetchOptions.body = JSON.stringify(Object.assign({ action }, requestOptions.body || {}));
      } else {
        const params = new URLSearchParams(Object.assign({ action }, requestOptions.params || {}));
        url += (url.includes("?") ? "&" : "?") + params.toString();
      }

      const response = await fetch(url, fetchOptions);
      if (!response.ok) {
        throw new Error("The check-in service is unavailable. Please try again.");
      }

      let data;
      try {
        data = await response.json();
      } catch (_error) {
        throw new Error("The check-in service returned an invalid response.");
      }

      if (!data || data.ok !== true) {
        throw new Error((data && data.error) || "The request could not be completed.");
      }
      return data;
    }

    return {
      getFamilies: () => request("families"),
      save: (payload) => request("save", { method: "POST", body: payload })
    };
  }

  function createDemoApi() {
    const delay = (value) => new Promise((resolve) => window.setTimeout(() => resolve(value), 180));
    const getRecords = () => {
      try {
        return JSON.parse(localStorage.getItem(DEMO_STORAGE_KEY) || "{}");
      } catch (_error) {
        return {};
      }
    };

    return {
      getFamilies: () => delay({ ok: true, families: demoFamilies }),
      save: (payload) => {
        const records = getRecords();
        const hadExistingRecord = Boolean(records[payload.family]);
        const record = {
          checkInId: records[payload.family]?.checkInId || crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          family: payload.family,
          members: payload.members,
          notes: payload.notes
        };
        records[payload.family] = record;
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(records));
        return delay({ ok: true, record, updated: hadExistingRecord });
      }
    };
  }

  function setLoading(message, visible) {
    elements.loadingText.textContent = message;
    elements.loadingStatus.hidden = !visible;
  }

  function readRememberedFamily() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_error) {
      return null;
    }
  }

  function rememberFamily(family) {
    try {
      localStorage.setItem(STORAGE_KEY, family);
    } catch (_error) {
      // The form remains usable when storage is disabled by the browser.
    }
  }

  function readCachedFamilies() {
    try {
      const cached = JSON.parse(localStorage.getItem(FAMILY_DATA_STORAGE_KEY) || "null");
      return Array.isArray(cached?.families) ? cached.families : null;
    } catch (_error) {
      return null;
    }
  }

  function cacheFamilies(families) {
    try {
      localStorage.setItem(FAMILY_DATA_STORAGE_KEY, JSON.stringify({
        cachedAt: new Date().toISOString(),
        families
      }));
    } catch (_error) {
      // The live response still works when browser storage is unavailable.
    }
  }

  function validFamilies(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((family) => (
      family &&
      typeof family.name === "string" &&
      family.name.length > 0 &&
      Array.isArray(family.members) &&
      family.members.every((member) => typeof member === "string" && member.length > 0)
    ));
  }

  function showError(message, retryVisible) {
    elements.errorMessage.textContent = message;
    elements.errorNotice.hidden = false;
    elements.retry.hidden = !retryVisible;
  }

  function clearError() {
    elements.errorNotice.hidden = true;
  }

  function setFormControls() {
    const hasFamily = state.families.has(elements.family.value);
    const disabled = state.loadingFamily || state.saving || !hasFamily;
    elements.submit.disabled = disabled;
    elements.family.disabled = state.saving || state.families.size === 0;
  }

  function setSubmitting(isSubmitting) {
    state.saving = isSubmitting;
    elements.submit.classList.toggle("is-loading", isSubmitting);
    elements.submitLabel.textContent = isSubmitting
      ? "Saving…"
      : (state.record ? "Update Check-In" : "Check In");
    elements.family.disabled = isSubmitting;
    elements.notes.disabled = isSubmitting;
    elements.memberGrid.querySelectorAll("input").forEach((input) => {
      input.disabled = isSubmitting;
    });
    setFormControls();
  }

  function renderFamilies(families) {
    state.families = new Map(families.map((family) => [family.name, family.members]));
    elements.family.replaceChildren(new Option("Select your family", ""));
    families.forEach((family) => elements.family.add(new Option(family.name, family.name)));
    elements.family.disabled = false;
  }

  function selectRememberedFamily() {
    const rememberedFamily = readRememberedFamily();
    if (rememberedFamily && state.families.has(rememberedFamily)) {
      elements.family.value = rememberedFamily;
      loadSelectedFamily();
      return true;
    }
    return false;
  }

  function refreshRenderedFamilies(families) {
    const currentFamily = elements.family.value;
    const selected = selectedMembers();
    const notes = elements.notes.value;
    const formWasOpen = !elements.membersField.hidden;

    renderFamilies(families);
    if (currentFamily && state.families.has(currentFamily)) {
      elements.family.value = currentFamily;
      if (formWasOpen) {
        const allowed = new Set(state.families.get(currentFamily));
        renderMembers(state.families.get(currentFamily), selected.filter((member) => allowed.has(member)));
        elements.notes.value = notes;
        updateNotesCount();
      }
    } else if (currentFamily) {
      state.record = null;
      elements.membersField.hidden = true;
      elements.notesField.hidden = true;
      elements.notes.value = "";
      updateNotesCount();
    }
    setFormControls();
  }

  function renderMembers(memberNames, selectedNames) {
    const selected = new Set(selectedNames || []);
    const fragment = document.createDocumentFragment();

    memberNames.forEach((name, index) => {
      const label = document.createElement("label");
      label.className = "member-choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "members";
      input.value = name;
      input.id = `member-${index}`;
      input.checked = selected.has(name);
      const text = document.createElement("span");
      text.textContent = name;
      label.append(input, text);
      fragment.append(label);
    });

    elements.memberGrid.replaceChildren(fragment);
    elements.membersField.hidden = false;
    elements.notesField.hidden = false;
  }

  async function loadFamilies() {
    clearError();
    elements.setupNotice.hidden = true;
    elements.family.disabled = true;

    if (!isDemo && !hasEndpoint) {
      setLoading("", false);
      elements.setupNotice.hidden = false;
      elements.family.replaceChildren(new Option("Setup required", ""));
      return;
    }

    const cachedFamilies = validFamilies(readCachedFamilies());
    const hasCache = cachedFamilies.length > 0;
    if (hasCache) {
      renderFamilies(cachedFamilies);
      selectRememberedFamily();
      setLoading("Refreshing families…", true);
    } else {
      setLoading("Loading families…", true);
    }

    try {
      const response = await api.getFamilies();
      const families = validFamilies(response.families);
      if (families.length === 0) {
        throw new Error("No families were found in the Lists sheet.");
      }

      if (!hasCache) {
        renderFamilies(families);
        if (!selectRememberedFamily()) elements.family.focus();
      } else if (JSON.stringify(families) !== JSON.stringify(cachedFamilies)) {
        refreshRenderedFamilies(families);
      }
      cacheFamilies(families);
      setLoading("", false);
    } catch (error) {
      setLoading("", false);
      if (hasCache) {
        showError("Showing the saved family list because the latest list could not be loaded.", true);
      } else {
        showError(error.message, true);
        elements.family.replaceChildren(new Option("Unable to load families", ""));
      }
    }
  }

  function loadSelectedFamily() {
    const family = elements.family.value;
    clearError();
    state.record = null;
    elements.membersField.hidden = true;
    elements.notesField.hidden = true;
    elements.memberGrid.replaceChildren();
    elements.notes.value = "";
    updateNotesCount();

    if (!state.families.has(family)) {
      setLoading("", false);
      setFormControls();
      return;
    }

    rememberFamily(family);
    renderMembers(state.families.get(family), []);
    elements.notes.value = "";
    elements.submitLabel.textContent = "Check In";
    updateNotesCount();
    setLoading("", false);
    setFormControls();
  }

  function selectedMembers() {
    return Array.from(elements.memberGrid.querySelectorAll("input:checked"), (input) => input.value);
  }

  function updateNotesCount() {
    elements.notesCount.textContent = String(elements.notes.value.length);
  }

  async function submitCheckIn(event) {
    event.preventDefault();
    clearError();
    const members = selectedMembers();
    setSubmitting(true);
    try {
      const response = await api.save({
        family: elements.family.value,
        members,
        notes: elements.notes.value.trim()
      });
      state.record = response.record;
      showSuccess(response.record);
    } catch (error) {
      showError(error.message, false);
      elements.errorNotice.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      setSubmitting(false);
    }
  }

  function showSuccess(record) {
    elements.successFamily.textContent = record.family;
    elements.successMembers.textContent = record.members.length === 0
      ? "No family members are marked present."
      : `${record.members.join(", ")} ${record.members.length === 1 ? "is" : "are"} checked in.`;
    elements.formPage.hidden = true;
    elements.actionBar.hidden = true;
    elements.successPage.hidden = false;
    document.body.style.overflow = "hidden";
    elements.anotherFamily.focus();
  }

  function showForm() {
    elements.successPage.hidden = true;
    elements.formPage.hidden = false;
    elements.actionBar.hidden = false;
    document.body.style.overflow = "";
    elements.submitLabel.textContent = "Update Check-In";
    setFormControls();
    elements.family.focus();
  }

  function startAnotherFamily() {
    state.record = null;
    elements.family.value = "";
    elements.memberGrid.replaceChildren();
    elements.membersField.hidden = true;
    elements.notesField.hidden = true;
    elements.notes.value = "";
    clearError();
    updateNotesCount();
    showForm();
    elements.submitLabel.textContent = "Check In";
    setFormControls();
  }

  function returnToRememberedFamily() {
    showForm();
    if (state.families.has(elements.family.value)) {
      loadSelectedFamily();
    } else if (!selectRememberedFamily()) {
      elements.family.focus();
    }
  }

  elements.family.addEventListener("change", loadSelectedFamily);
  elements.memberGrid.addEventListener("change", () => {
    setFormControls();
  });
  elements.notes.addEventListener("input", updateNotesCount);
  elements.form.addEventListener("submit", submitCheckIn);
  elements.retry.addEventListener("click", loadFamilies);
  elements.anotherFamily.addEventListener("click", startAnotherFamily);

  window.addEventListener("beforeinstallprompt", (event) => {
    const isAndroid = /Android/i.test(navigator.userAgent);
    const isInstalled = window.matchMedia("(display-mode: standalone)").matches;
    if (!isAndroid || isInstalled) return;

    event.preventDefault();
    deferredInstallPrompt = event;
    elements.install.hidden = false;
  });

  elements.install.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    elements.install.hidden = true;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.install.hidden = true;
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && !elements.successPage.hidden) {
      resetConfirmationOnResume = true;
    } else if (!document.hidden && resetConfirmationOnResume) {
      resetConfirmationOnResume = false;
      returnToRememberedFamily();
    }
  });

  window.addEventListener("pagehide", () => {
    if (!elements.successPage.hidden) resetConfirmationOnResume = true;
  });

  window.addEventListener("pageshow", () => {
    if (resetConfirmationOnResume) {
      resetConfirmationOnResume = false;
      returnToRememberedFamily();
    }
  });

  loadFamilies();

  // Remove the earlier offline-cache worker. The app requires a live connection
  // and remains installable through its web app manifest.
  if ("serviceWorker" in navigator) {
    const appScope = new URL("./", window.location.href).href;
    navigator.serviceWorker.getRegistration(appScope)
      .then((registration) => registration?.scope === appScope && registration.unregister())
      .catch(() => {});
  }
})();
