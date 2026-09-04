(function () {
  "use strict";

  const STORAGE_KEY = "summit-check-in-family";
  const FAMILY_DATA_STORAGE_KEY = "summit-check-in-families-v1";
  const DEMO_STORAGE_KEY = "summit-check-in-demo-records";
  const ACCESS_PASSWORD_STORAGE_KEY = "summit-check-in-access-password";
  const VISITOR_FAMILY = "Visitor";
  const searchParams = new URLSearchParams(window.location.search);
  const isDemo = searchParams.get("demo") === "1";
  const requestedFamily = String(searchParams.get("family") || "").trim();
  const returnToReports = searchParams.get("return") === "reports";

  const elements = {
    appShell: document.getElementById("app-shell"),
    accessPage: document.getElementById("access-page"),
    accessForm: document.getElementById("access-form"),
    accessPassword: document.getElementById("access-password"),
    accessError: document.getElementById("access-error"),
    accessSubmit: document.getElementById("access-submit"),
    formPage: document.getElementById("form-page"),
    adminLink: document.getElementById("admin-link"),
    install: document.getElementById("install-button"),
    form: document.getElementById("check-in-form"),
    family: document.getElementById("family-select"),
    membersField: document.getElementById("members-field"),
    memberGrid: document.getElementById("member-grid"),
    visitorField: document.getElementById("visitor-field"),
    visitorNames: document.getElementById("visitor-names"),
    notesField: document.getElementById("notes-field"),
    notes: document.getElementById("notes"),
    notesCount: document.getElementById("notes-count"),
    loadingStatus: document.getElementById("loading-status"),
    loadingText: document.getElementById("loading-text"),
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
    saving: false,
    password: "",
    pendingSubmission: null
  };

  let deferredInstallPrompt = null;
  let resetConfirmationOnResume = false;
  let requestedFamilyApplied = false;

  const demoFamilies = [
    { name: "Dickinson, L", members: ["Lisa", "Abby", "Noah", "Hannah", "Andrew"] },
    { name: "Garcia", members: ["Elena", "Mateo", "Sofia"] },
    { name: "Williams", members: ["Jordan", "Taylor"] }
  ];

  const api = isDemo ? createDemoApi() : createLiveApi();

  if (isDemo) {
    elements.adminLink.href = "admin.html?demo=1";
  }

  function createLiveApi() {
    async function request(path, options) {
      const requestOptions = options || {};
      const fetchOptions = {
        method: requestOptions.method || "GET",
        cache: "no-store",
        headers: { "X-Summit-Password": state.password }
      };

      if (fetchOptions.method === "POST") {
        fetchOptions.headers["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(requestOptions.body || {});
      }

      let response;
      try {
        response = await fetch(`/api/${path}`, fetchOptions);
      } catch (_error) {
        throw new Error("The check-in service is unavailable. Please try again.");
      }
      let data;
      try {
        data = await response.json();
      } catch (_error) {
        throw new Error(response.ok
          ? "The check-in service returned an invalid response."
          : "The check-in service is unavailable. Please try again.");
      }

      if (!response.ok || !data || data.ok !== true) {
        const error = new Error((data && data.error) || "The request could not be completed.");
        error.code = data && data.code;
        throw error;
      }
      return data;
    }

    return {
      getFamilies: () => request("families"),
      save: (payload) => request("check-ins", { method: "POST", body: payload }),
      getStatus: (payload) => request("check-ins/status", { method: "POST", body: payload })
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
        const recordKey = payload.family === VISITOR_FAMILY ? payload.submissionId : payload.family;
        const existingRecord = records[recordKey];
        const hadExistingRecord = Boolean(existingRecord);
        const record = {
          checkInId: existingRecord?.checkInId || recordKey,
          timestamp: new Date().toISOString(),
          family: payload.family,
          members: payload.members,
          notes: payload.notes
        };
        records[recordKey] = record;
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(records));
        return delay({ ok: true, record, updated: hadExistingRecord });
      },
      getStatus: (payload) => {
        const records = getRecords();
        const recordKey = payload.family === VISITOR_FAMILY ? payload.submissionId : payload.family;
        const record = records[recordKey] || null;
        const saved = Boolean(record) && submissionMatchesRecord(payload, record);
        return delay({ ok: true, saved, record: saved ? record : null });
      }
    };
  }

  function setLoading(message, visible) {
    elements.loadingText.textContent = message;
    elements.loadingStatus.hidden = !visible;
  }

  function readStoredPassword(key) {
    try {
      return localStorage.getItem(key) || "";
    } catch (_error) {
      return "";
    }
  }

  function storePassword(password) {
    try {
      localStorage.setItem(ACCESS_PASSWORD_STORAGE_KEY, password);
    } catch (_error) {
      // Access remains valid for this page load when storage is unavailable.
    }
  }

  function forgetRejectedPassword(password) {
    try {
      if (localStorage.getItem(ACCESS_PASSWORD_STORAGE_KEY) === password) {
        localStorage.removeItem(ACCESS_PASSWORD_STORAGE_KEY);
      }
    } catch (_error) {
      // The password screen still appears when storage is unavailable.
    }
  }

  function isAccessError(error) {
    return error && (error.code === "AUTH_REQUIRED" || error.code === "AUTH_NOT_CONFIGURED");
  }

  function showAccess(message) {
    forgetRejectedPassword(state.password);
    state.password = "";
    elements.appShell.hidden = true;
    elements.successPage.hidden = true;
    elements.accessPage.hidden = false;
    elements.accessError.textContent = message || "";
    elements.accessError.hidden = !message;
    elements.accessPassword.value = "";
    elements.accessPassword.focus();
  }

  function showApp() {
    elements.accessPage.hidden = true;
    elements.appShell.hidden = false;
    document.body.style.overflow = "";
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
    const isVisitor = elements.family.value === VISITOR_FAMILY;
    const hasFamily = state.families.has(elements.family.value);
    const hasVisitorNames = visitorMembers().length > 0;
    const disabled = state.loadingFamily || state.saving || (!hasFamily && !isVisitor) || (isVisitor && !hasVisitorNames);
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
    elements.visitorNames.disabled = isSubmitting;
    elements.memberGrid.querySelectorAll("input").forEach((input) => {
      input.disabled = isSubmitting;
    });
    setFormControls();
  }

  function renderFamilies(families) {
    state.families = new Map(families.map((family) => [family.name, family.members]));
    elements.family.replaceChildren(new Option("Select your family", ""));
    families.forEach((family) => elements.family.add(new Option(family.name, family.name)));
    elements.family.add(new Option(VISITOR_FAMILY, VISITOR_FAMILY));
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

  function selectInitialFamily() {
    if (requestedFamilyApplied) return true;
    if (requestedFamily && state.families.has(requestedFamily)) {
      requestedFamilyApplied = true;
      elements.family.value = requestedFamily;
      loadSelectedFamily();
      return true;
    }
    return selectRememberedFamily();
  }

  function refreshRenderedFamilies(families) {
    const currentFamily = elements.family.value;
    const selected = selectedMembers();
    const notes = elements.notes.value;
    const visitorNames = elements.visitorNames.value;
    const formWasOpen = !elements.notesField.hidden;

    renderFamilies(families);
    if (currentFamily === VISITOR_FAMILY) {
      elements.family.value = currentFamily;
      if (formWasOpen) {
        showVisitorFields();
        elements.visitorNames.value = visitorNames;
        elements.notes.value = notes;
        updateNotesCount();
      }
    } else if (currentFamily && state.families.has(currentFamily)) {
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
      elements.visitorField.hidden = true;
      elements.notesField.hidden = true;
      elements.visitorNames.value = "";
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

  function showVisitorFields() {
    elements.membersField.hidden = true;
    elements.memberGrid.replaceChildren();
    elements.visitorField.hidden = false;
    elements.notesField.hidden = false;
  }

  async function loadFamilies(options) {
    const unlocking = Boolean(options && options.unlocking);
    clearError();
    elements.family.disabled = true;

    const cachedFamilies = validFamilies(readCachedFamilies());
    const hasCache = cachedFamilies.length > 0;
    if (hasCache) {
      renderFamilies(cachedFamilies);
      selectInitialFamily();
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
        if (!selectInitialFamily()) elements.family.focus();
      } else if (JSON.stringify(families) !== JSON.stringify(cachedFamilies)) {
        refreshRenderedFamilies(families);
        selectInitialFamily();
      }
      cacheFamilies(families);
      setLoading("", false);
      return response;
    } catch (error) {
      setLoading("", false);
      if (isAccessError(error)) {
        showAccess(error.message);
        return null;
      }
      if (unlocking) {
        elements.accessError.textContent = error.message;
        elements.accessError.hidden = false;
        return null;
      }
      if (hasCache) {
        showError("Showing the saved family list because the latest list could not be loaded.", true);
      } else {
        showError(error.message, true);
        elements.family.replaceChildren(new Option("Unable to load families", ""));
      }
      return null;
    }
  }

  function loadSelectedFamily() {
    const family = elements.family.value;
    clearError();
    state.record = null;
    elements.membersField.hidden = true;
    elements.visitorField.hidden = true;
    elements.notesField.hidden = true;
    elements.memberGrid.replaceChildren();
    elements.visitorNames.value = "";
    elements.notes.value = "";
    updateNotesCount();

    if (family === VISITOR_FAMILY) {
      showVisitorFields();
      elements.submitLabel.textContent = "Check In";
      setLoading("", false);
      setFormControls();
      elements.visitorNames.focus();
      return;
    }

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
    if (elements.family.value === VISITOR_FAMILY) return visitorMembers();
    return Array.from(elements.memberGrid.querySelectorAll("input:checked"), (input) => input.value);
  }

  function visitorMembers() {
    const seen = new Set();
    return elements.visitorNames.value
      .split(/[\n,]+/)
      .map((name) => name.trim())
      .filter((name) => {
        const key = name.toLocaleLowerCase();
        if (!name || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function updateNotesCount() {
    elements.notesCount.textContent = String(elements.notes.value.length);
  }

  function createSubmissionId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  }

  function sameMembers(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    const leftSorted = left.slice().sort();
    const rightSorted = right.slice().sort();
    return leftSorted.every((member, index) => member === rightSorted[index]);
  }

  function submissionMatchesRecord(payload, record) {
    return record.family === payload.family &&
      record.notes === payload.notes &&
      sameMembers(record.members, payload.members);
  }

  function currentSubmission(members) {
    const draft = {
      family: elements.family.value,
      members,
      notes: elements.notes.value.trim()
    };
    const pending = state.pendingSubmission;
    if (pending && submissionMatchesRecord(draft, pending)) return pending;
    state.pendingSubmission = Object.assign({ submissionId: createSubmissionId() }, draft);
    return state.pendingSubmission;
  }

  async function confirmSaved(payload) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
      }
      try {
        const response = await api.getStatus(payload);
        if (response.saved) return response.record;
      } catch (error) {
        if (isAccessError(error)) throw error;
      }
    }
    return null;
  }

  async function submitCheckIn(event) {
    event.preventDefault();
    clearError();
    const members = selectedMembers();
    const payload = currentSubmission(members);
    setSubmitting(true);
    try {
      const response = await api.save(payload);
      state.pendingSubmission = null;
      state.record = response.record;
      showSuccess(response.record);
    } catch (error) {
      if (isAccessError(error)) {
        state.pendingSubmission = null;
        showAccess(error.message);
        return;
      }
      elements.submitLabel.textContent = "Confirming.";
      let confirmedRecord;
      try {
        confirmedRecord = await confirmSaved(payload);
      } catch (confirmationError) {
        if (isAccessError(confirmationError)) {
          state.pendingSubmission = null;
          showAccess(confirmationError.message);
          return;
        }
        confirmedRecord = null;
      }
      if (confirmedRecord) {
        state.pendingSubmission = null;
        state.record = confirmedRecord;
        showSuccess(confirmedRecord);
        return;
      }
      showError(error.message, false);
      elements.errorNotice.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      setSubmitting(false);
    }
  }

  function showSuccess(record) {
    if (returnToReports) {
      window.location.href = `admin.html${isDemo ? "?demo=1" : ""}`;
      return;
    }
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
    state.pendingSubmission = null;
    elements.family.value = "";
    elements.memberGrid.replaceChildren();
    elements.membersField.hidden = true;
    elements.visitorField.hidden = true;
    elements.notesField.hidden = true;
    elements.visitorNames.value = "";
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
  elements.visitorNames.addEventListener("input", setFormControls);
  elements.notes.addEventListener("input", updateNotesCount);
  elements.form.addEventListener("submit", submitCheckIn);
  elements.retry.addEventListener("click", loadFamilies);
  elements.anotherFamily.addEventListener("click", startAnotherFamily);
  elements.accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = elements.accessPassword.value;
    if (!password) return;
    state.password = password;
    elements.accessError.hidden = true;
    elements.accessSubmit.disabled = true;
    elements.accessSubmit.textContent = "Checking...";
    try {
      const response = await loadFamilies({ unlocking: true });
      if (!response) return;
      storePassword(password);
      showApp();
      elements.family.focus();
    } finally {
      elements.accessSubmit.disabled = false;
      elements.accessSubmit.textContent = "Continue";
    }
  });

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

  if (isDemo) {
    showApp();
    loadFamilies();
  } else {
    state.password = readStoredPassword(ACCESS_PASSWORD_STORAGE_KEY);
    if (state.password) {
      showApp();
      loadFamilies();
    } else {
      showAccess();
    }
  }

  // Remove the earlier offline-cache worker. The app requires a live connection
  // and remains installable through its web app manifest.
  if ("serviceWorker" in navigator) {
    const appScope = new URL("./", window.location.href).href;
    navigator.serviceWorker.getRegistration(appScope)
      .then((registration) => registration?.scope === appScope && registration.unregister())
      .catch(() => {});
  }
})();
