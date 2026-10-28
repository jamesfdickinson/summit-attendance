(function () {
  "use strict";

  const CLIENT_ADMIN_PASSWORD = "board26";
  const ADMIN_UNLOCK_STORAGE_KEY = "summit-check-in-admin-unlock";
  const config = window.SUMMIT_CONFIG || {};
  const endpoint = String(config.API_URL || "").trim();
  const isDemo = new URLSearchParams(window.location.search).get("demo") === "1";
  const hasEndpoint = /^https:\/\/script\.google\.com\/.+\/exec(?:\?.*)?$/i.test(endpoint);
  const demoFamilies = [
    { name: "Dickinson, L", members: ["Lisa", "Abby", "Noah", "Hannah", "Andrew"] },
    { name: "Garcia", members: ["Elena", "Mateo", "Sofia"] },
    { name: "Williams", members: ["Jordan", "Taylor"] }
  ];

  const elements = {
    adminPage: document.getElementById("admin-page"),
    accessPage: document.getElementById("access-page"),
    accessForm: document.getElementById("access-form"),
    accessPassword: document.getElementById("access-password"),
    accessError: document.getElementById("access-error"),
    accessSubmit: document.getElementById("access-submit"),
    accessBack: document.getElementById("access-back"),
    loading: document.getElementById("admin-loading"),
    error: document.getElementById("admin-error"),
    errorMessage: document.getElementById("admin-error-message"),
    content: document.getElementById("report-content"),
    back: document.getElementById("back-button"),
    refresh: document.getElementById("refresh-button"),
    reportDate: document.getElementById("report-date"),
    dailyDate: document.getElementById("daily-date"),
    familyPercent: document.getElementById("family-percent"),
    familyCount: document.getElementById("family-count"),
    memberCount: document.getElementById("member-count"),
    progress: document.getElementById("daily-progress"),
    progressFill: document.getElementById("daily-progress-fill"),
    dailyList: document.getElementById("daily-list"),
    yearlyDescription: document.getElementById("yearly-description"),
    yearlyList: document.getElementById("yearly-list"),
    parentsDescription: document.getElementById("parents-description"),
    parentsList: document.getElementById("parents-list"),
    parentsEmpty: document.getElementById("parents-empty"),
    tabs: Array.from(document.querySelectorAll('[role="tab"]')),
    panels: Array.from(document.querySelectorAll('[role="tabpanel"]'))
  };

  if (isDemo) {
    elements.back.href = "./?demo=1";
    elements.accessBack.href = "./?demo=1";
  }

  function readRememberedUnlock() {
    try {
      return localStorage.getItem(ADMIN_UNLOCK_STORAGE_KEY) === CLIENT_ADMIN_PASSWORD;
    } catch (_error) {
      return false;
    }
  }

  function rememberUnlock() {
    try {
      localStorage.setItem(ADMIN_UNLOCK_STORAGE_KEY, CLIENT_ADMIN_PASSWORD);
    } catch (_error) {
      // The reports remain available for this page load when storage is disabled.
    }
  }

  function forgetOutdatedUnlock() {
    try {
      const saved = localStorage.getItem(ADMIN_UNLOCK_STORAGE_KEY);
      if (saved && saved !== CLIENT_ADMIN_PASSWORD) {
        localStorage.removeItem(ADMIN_UNLOCK_STORAGE_KEY);
      }
    } catch (_error) {
      // The password screen still works when storage is disabled.
    }
  }

  function showAccess(message) {
    elements.adminPage.hidden = true;
    elements.accessPage.hidden = false;
    elements.accessError.textContent = message || "";
    elements.accessError.hidden = !message;
    elements.accessPassword.value = "";
    elements.accessPassword.focus();
  }

  function showAdmin() {
    elements.accessPage.hidden = true;
    elements.adminPage.hidden = false;
  }

  function formatDate(dateText) {
    const date = new Date(`${dateText}T12:00:00`);
    return new Intl.DateTimeFormat(undefined, {
      weekday: "long", month: "long", day: "numeric", year: "numeric"
    }).format(date);
  }

  function makeStatusRow(family) {
    const row = document.createElement("div");
    row.className = "report-row";
    const name = document.createElement("strong");
    name.textContent = family.name;
    const detail = document.createElement("span");
    detail.className = family.checkedIn ? "status status-present" : "status status-absent";
    detail.textContent = family.checkedIn
      ? `Checked in · ${family.checkedInMembers}/${family.totalMembers} members`
      : "Not checked in";
    const actions = document.createElement("div");
    actions.className = "daily-row-actions";
    actions.append(detail);
    if (!family.checkedIn) {
      const checkIn = document.createElement("a");
      checkIn.className = "check-in-link";
      checkIn.href = `./?${isDemo ? "demo=1&" : ""}family=${encodeURIComponent(family.name)}&return=reports`;
      checkIn.textContent = "Check in";
      actions.append(checkIn);
    }
    row.append(name, actions);
    return row;
  }

  function makeYearRow(family) {
    const row = document.createElement("div");
    row.className = "report-row yearly-row";
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = family.name;
    const count = document.createElement("small");
    count.textContent = `${family.attendedThursdays} of ${family.totalThursdays} Thursdays`;
    text.append(name, count);
    const percent = document.createElement("strong");
    percent.className = "year-percent";
    percent.textContent = `${family.percent}%`;
    row.append(text, percent);
    return row;
  }

  function selectTab(selectedTab, moveFocus) {
    elements.tabs.forEach((tab) => {
      const isSelected = tab === selectedTab;
      tab.setAttribute("aria-selected", String(isSelected));
      tab.tabIndex = isSelected ? 0 : -1;
    });
    elements.panels.forEach((panel) => {
      panel.hidden = panel.id !== selectedTab.getAttribute("aria-controls");
    });
    if (moveFocus) selectedTab.focus();
  }

  elements.tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab, false));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let nextIndex = index;
      if (event.key === "ArrowLeft") nextIndex = (index - 1 + elements.tabs.length) % elements.tabs.length;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % elements.tabs.length;
      if (event.key === "Home") nextIndex = 0;
      if (event.key === "End") nextIndex = elements.tabs.length - 1;
      selectTab(elements.tabs[nextIndex], true);
    });
  });

  function render(reports) {
    const daily = reports.daily;
    elements.reportDate.textContent = `Current as of ${formatDate(reports.date)}`;
    elements.dailyDate.textContent = formatDate(reports.date);
    elements.familyPercent.textContent = `${daily.familyPercent}%`;
    elements.familyCount.textContent = `${daily.checkedInFamilies} of ${daily.totalFamilies} families`;
    elements.memberCount.textContent = `${daily.checkedInMembers} / ${daily.totalMembers}`;
    elements.progress.setAttribute("aria-valuenow", String(daily.familyPercent));
    elements.progressFill.style.width = `${daily.familyPercent}%`;
    elements.dailyList.replaceChildren(...daily.families.map(makeStatusRow));
    elements.yearlyDescription.textContent = `${reports.yearly.thursdaysWithData} Thursdays with data in this sheet`;
    elements.yearlyList.replaceChildren(...reports.yearly.families.map(makeYearRow));
    const parents = reports.parents;
    elements.parentsDescription.textContent = parents
      ? `${parents.totalThursdays} Thursdays with data in this sheet`
      : "";
    elements.parentsEmpty.textContent = !parents ? "Update the reporting service to load parent attendance."
      : parents.message || (parents.parents.length ? "" : "No parents found. Set type to Parent for each parent in Lists.");
    elements.parentsEmpty.hidden = !elements.parentsEmpty.textContent;
    elements.parentsList.replaceChildren(...(parents?.parents || []).map(parent => {
      const row = makeYearRow(parent);
      const family = document.createElement("small");
      family.textContent = parent.family;
      row.firstChild.insertBefore(family, row.firstChild.lastChild);
      if (!parent.totalThursdays) row.lastChild.textContent = "N/A";
      return row;
    }));
    elements.parentsList.hidden = !parents?.parents.length;
    elements.content.hidden = false;
  }

  async function getLiveReports() {
    if (!hasEndpoint) throw new Error("The Google Apps Script URL has not been configured yet.");
    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "reports" })
    });
    if (!response.ok) throw new Error("The reporting service is unavailable. Please try again.");
    const data = await response.json();
    if (!data || data.ok !== true) {
      if (data && data.error === "Unknown request.") {
        throw new Error("The Google Apps Script deployment is out of date. Deploy a new version containing the reports endpoint, then refresh this page.");
      }
      throw new Error((data && data.error) || "The reports could not be loaded.");
    }
    return data;
  }

  function getDemoReports() {
    let records = {};
    try {
      records = JSON.parse(localStorage.getItem("summit-check-in-demo-records") || "{}");
    } catch (_error) {
      records = {};
    }
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const year = now.getFullYear();
    const recordDates = Object.values(records)
      .map((record) => String(record?.timestamp || "").slice(0, 10))
      .filter((recordDate) => /^\d{4}-\d{2}-\d{2}$/.test(recordDate))
      .sort();
    const startDate = recordDates[0] || "";
    const endDate = recordDates[recordDates.length - 1] || "";
    const thursdaysWithData = new Set(recordDates.filter((recordDate) => (
      new Date(`${recordDate}T12:00:00`).getDay() === 4
    ))).size;
    const families = demoFamilies.map((family) => {
      const record = records[family.name];
      const members = Array.isArray(record?.members) ? record.members : [];
      const checkedIn = members.length > 0 && String(record.timestamp || "").slice(0, 10) === date;
      return { name: family.name, checkedIn, checkedInMembers: checkedIn ? members.length : 0, totalMembers: family.members.length };
    });
    function demoFamilyAttended(name) {
      const record = records[name];
      const day = String(record?.timestamp || "").slice(0, 10);
      return record?.members?.length > 0 && new Date(day + "T12:00:00Z").getUTCDay() === 4;
    }
    const checkedInFamilies = families.filter((family) => family.checkedIn).length;
    return {
      date,
      year,
      daily: {
        checkedInFamilies,
        totalFamilies: families.length,
        familyPercent: families.length ? Math.round(checkedInFamilies / families.length * 100) : 0,
        checkedInMembers: families.reduce((sum, family) => sum + family.checkedInMembers, 0),
        totalMembers: families.reduce((sum, family) => sum + family.totalMembers, 0),
        families
      },
      parents: getDemoParentReport(records),
      yearly: {
        startDate,
        endDate,
        thursdaysWithData,
        families: families.map((family) => ({
          name: family.name,
          attendedThursdays: demoFamilyAttended(family.name) ? 1 : 0,
          totalThursdays: thursdaysWithData,
          percent: demoFamilyAttended(family.name) && thursdaysWithData ? Math.round(100 / thursdaysWithData) : 0
        }))
      }
    };
  }

  function getDemoParentReport(records) {
    const totalThursdays = new Set(Object.values(records).map(record => String(record?.timestamp || "").slice(0, 10))
      .filter(date => new Date(date + "T12:00:00Z").getUTCDay() === 4)).size;
    return { totalThursdays, parents: demoFamilies.map(family => {
      const name = family.members[0];
      const record = records[family.name];
      const date = String(record?.timestamp || "").slice(0, 10);
      const attendedThursdays = record?.members?.includes(name)
        && new Date(date + "T12:00:00Z").getUTCDay() === 4 ? 1 : 0;
      return { name, family: family.name, attendedThursdays, totalThursdays,
        percent: totalThursdays ? Math.round(attendedThursdays / totalThursdays * 100) : 0 };
    }) };
  }

  async function loadReports() {
    elements.loading.hidden = false;
    elements.error.hidden = true;
    elements.refresh.disabled = true;
    try {
      const response = isDemo
        ? { reports: getDemoReports() }
        : await getLiveReports();
      render(response.reports);
      return response;
    } catch (error) {
      elements.errorMessage.textContent = error.message;
      elements.error.hidden = false;
      return null;
    } finally {
      elements.loading.hidden = true;
      elements.refresh.disabled = false;
    }
  }

  elements.refresh.addEventListener("click", loadReports);
  elements.accessForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const enteredPassword = elements.accessPassword.value;
    if (!enteredPassword) return;
    if (enteredPassword !== CLIENT_ADMIN_PASSWORD) {
      elements.accessError.textContent = "The password is incorrect. Please try again.";
      elements.accessError.hidden = false;
      elements.accessPassword.select();
      return;
    }
    elements.accessError.hidden = true;
    elements.accessSubmit.disabled = true;
    elements.accessSubmit.textContent = "Loading...";
    try {
      rememberUnlock();
      showAdmin();
      await loadReports();
    } finally {
      elements.accessSubmit.disabled = false;
      elements.accessSubmit.textContent = "View reports";
    }
  });

  forgetOutdatedUnlock();
  if (readRememberedUnlock()) {
    showAdmin();
    loadReports();
  } else {
    showAccess();
  }
})();
