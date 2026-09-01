(function () {
  "use strict";

  const STORAGE_KEY = "summit-check-in-family";
  const DEMO_STORAGE_KEY = "summit-check-in-demo-records";
  const config = window.SUMMIT_CONFIG || {};
  const endpoint = String(config.API_URL || "").trim();
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const hasEndpoint = /^https:\/\/script\.google\.com\/.+\/exec(?:\?.*)?$/i.test(endpoint);

  const elements = {
    formPage: document.getElementById("form-page"),
    form: document.getElementById("check-in-form"),
    family: document.getElementById("family-select"),
    membersField: document.getElementById("members-field"),
    memberGrid: document.getElementById("member-grid"),
    membersError: document.getElementById("members-error"),
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
    cancel: document.getElementById("cancel-button"),
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
    const selectedCount = elements.memberGrid.querySelectorAll("input:checked").length;
    const disabled = state.loadingFamily || state.saving || !hasFamily || selectedCount === 0;
    elements.submit.disabled = disabled;
    elements.cancel.disabled = state.loadingFamily || state.saving || !hasFamily;
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
    setLoading("Loading families…", true);
    elements.family.disabled = true;

    if (!isDemo && !hasEndpoint) {
      setLoading("", false);
      elements.setupNotice.hidden = false;
      elements.family.replaceChildren(new Option("Setup required", ""));
      return;
    }

    try {
      const response = await api.getFamilies();
      const families = Array.isArray(response.families) ? response.families : [];
      renderFamilies(families);
      setLoading("", false);

      const rememberedFamily = readRememberedFamily();
      if (rememberedFamily && state.families.has(rememberedFamily)) {
        elements.family.value = rememberedFamily;
        loadSelectedFamily();
      } else {
        elements.family.focus();
      }
    } catch (error) {
      setLoading("", false);
      showError(error.message, true);
      elements.family.replaceChildren(new Option("Unable to load families", ""));
    }
  }

  function loadSelectedFamily() {
    const family = elements.family.value;
    clearError();
    elements.membersError.hidden = true;
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

  function resetCurrentForm() {
    elements.membersError.hidden = true;
    const selected = state.record?.members || [];
    elements.memberGrid.querySelectorAll("input").forEach((input) => {
      input.checked = selected.includes(input.value);
    });
    elements.notes.value = state.record?.notes || "";
    updateNotesCount();
    setFormControls();
    elements.family.focus();
  }

  function updateNotesCount() {
    elements.notesCount.textContent = String(elements.notes.value.length);
  }

  async function submitCheckIn(event) {
    event.preventDefault();
    clearError();
    const members = selectedMembers();
    if (members.length === 0) {
      elements.membersError.hidden = false;
      elements.memberGrid.querySelector("input")?.focus();
      return;
    }

    elements.membersError.hidden = true;
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
    elements.successMembers.textContent = `${record.members.join(", ")} ${record.members.length === 1 ? "is" : "are"} checked in.`;
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
    elements.membersError.hidden = true;
    clearError();
    updateNotesCount();
    showForm();
    elements.submitLabel.textContent = "Check In";
    setFormControls();
  }

  elements.family.addEventListener("change", loadSelectedFamily);
  elements.memberGrid.addEventListener("change", () => {
    elements.membersError.hidden = selectedMembers().length > 0;
    setFormControls();
  });
  elements.notes.addEventListener("input", updateNotesCount);
  elements.form.addEventListener("submit", submitCheckIn);
  elements.cancel.addEventListener("click", resetCurrentForm);
  elements.retry.addEventListener("click", loadFamilies);
  elements.anotherFamily.addEventListener("click", startAnotherFamily);

  loadFamilies();
})();
