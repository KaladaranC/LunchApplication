const CONFIG = {
  appsScriptUrl: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
  pollIntervalMs: 10000,
};

const PEOPLE = [
  "Kajanan",
  "Thakshayan",
  "Vibooshan",
  "Kirushan",
  "Varadhan",
  "Kaladaran",
  "Ruchini",
  "Ghayan",
];

const stateKey = "dailyLunchState";
const peopleContainer = document.querySelector("#people-container");
const lunchCount = document.querySelector("#lunch-count");
const todayLabel = document.querySelector("#today-label");
const smsStatus = document.querySelector("#sms-status");
const sendNowButton = document.querySelector("#send-now");
const resetNowButton = document.querySelector("#reset-now");

let state = loadCachedState();
let pendingWrites = 0;

renderPeople();
renderState("Loading shared count...");
loadSharedState();
window.setInterval(loadSharedState, CONFIG.pollIntervalMs);

sendNowButton.addEventListener("click", () => sendLunchSms());
resetNowButton.addEventListener("click", () => resetToday());

function renderPeople() {
  peopleContainer.innerHTML = "";

  PEOPLE.forEach((name, index) => {
    const id = `person-${index}`;
    const row = document.createElement("label");
    row.className = "person-row";
    row.htmlFor = id;

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = id;
    checkbox.value = name;
    checkbox.checked = state.selectedNames.includes(name);
    checkbox.addEventListener("change", () => updatePerson(name, checkbox.checked));

    const label = document.createElement("span");
    label.textContent = name;

    row.append(checkbox, label);
    peopleContainer.append(row);
  });
}

async function loadSharedState() {
  if (!isConfigured() || pendingWrites > 0) {
    return;
  }

  try {
    const result = await callBackend("getState");
    applySharedState(result);
  } catch (error) {
    setStatus(`Could not load shared count: ${friendlyError(error)}`, "is-error");
  }
}

async function updatePerson(name, selected) {
  const nextState = updateLocalSelection(name, selected);
  state = nextState;
  persistCachedState();
  syncCheckboxes();
  renderState("Saving...");

  if (!isConfigured()) {
    setStatus("Add Apps Script URL first", "is-error");
    return;
  }

  pendingWrites += 1;

  try {
    const result = await callBackend("setSelection", { name, selected });
    applySharedState(result);
  } catch (error) {
    state = loadCachedState();
    syncCheckboxes();
    renderState(`Save failed: ${friendlyError(error)}`, "is-error");
  } finally {
    pendingWrites = Math.max(0, pendingWrites - 1);
  }
}

async function resetToday() {
  if (!isConfigured()) {
    setStatus("Add Apps Script URL first", "is-error");
    return;
  }

  renderState("Resetting...");
  pendingWrites += 1;

  try {
    const result = await callBackend("resetToday");
    applySharedState(result, "Reset");
  } catch (error) {
    renderState(`Reset failed: ${friendlyError(error)}`, "is-error");
  } finally {
    pendingWrites = Math.max(0, pendingWrites - 1);
  }
}

async function sendLunchSms() {
  if (!isConfigured()) {
    setStatus("Add Apps Script URL first", "is-error");
    return;
  }

  renderState("Sending SMS...");
  pendingWrites += 1;

  try {
    const result = await callBackend("sendSms");
    applySharedState(result, "SMS sent");
  } catch (error) {
    renderState(`SMS failed: ${friendlyError(error)}`, "is-error");
  } finally {
    pendingWrites = Math.max(0, pendingWrites - 1);
  }
}

async function callBackend(action, payload = {}) {
  const response = await fetch(CONFIG.appsScriptUrl, {
    method: "POST",
    body: JSON.stringify({ action, ...payload }),
    headers: {
      "Content-Type": "text/plain;charset=utf-8",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const result = await response.json();
  if (!result.ok) {
    throw new Error(result.error || "Request failed");
  }

  return result;
}

function applySharedState(result, message = "") {
  state = normalizeState(result);
  persistCachedState();
  syncCheckboxes();
  renderState(message);
}

function renderState(message = "") {
  resetIfNewDayLocally();
  todayLabel.textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  lunchCount.textContent = state.selectedNames.length;

  if (message) {
    setStatus(message, "");
    return;
  }

  if (state.lastScheduledSentAt) {
    setStatus(`Last SMS at ${formatTime(state.lastScheduledSentAt)}`, "");
  } else {
    setStatus("Waiting for 8:00 AM", "");
  }
}

function updateLocalSelection(name, selected) {
  const selectedNames = new Set(state.selectedNames);
  if (selected) {
    selectedNames.add(name);
  } else {
    selectedNames.delete(name);
  }

  return {
    ...state,
    date: todayKey(),
    selectedNames: PEOPLE.filter((person) => selectedNames.has(person)),
    updatedAt: new Date().toISOString(),
  };
}

function loadCachedState() {
  const raw = localStorage.getItem(stateKey);
  if (!raw) {
    return freshState(todayKey());
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.date !== todayKey()) {
      return freshState(todayKey());
    }
    return normalizeState(parsed);
  } catch {
    return freshState(todayKey());
  }
}

function persistCachedState() {
  localStorage.setItem(stateKey, JSON.stringify(state));
}

function freshState(date) {
  return {
    date,
    selectedNames: [],
    updatedAt: "",
    lastManualSentAt: "",
    lastScheduledSentAt: "",
  };
}

function normalizeState(result) {
  return {
    date: result.date || todayKey(),
    selectedNames: Array.isArray(result.selectedNames) ? result.selectedNames : [],
    updatedAt: result.updatedAt || "",
    lastManualSentAt: result.lastManualSentAt || "",
    lastScheduledSentAt: result.lastScheduledSentAt || "",
  };
}

function resetIfNewDayLocally() {
  if (state.date !== todayKey()) {
    state = freshState(todayKey());
    persistCachedState();
    syncCheckboxes();
  }
}

function syncCheckboxes() {
  document.querySelectorAll(".person-row input").forEach((checkbox) => {
    checkbox.checked = state.selectedNames.includes(checkbox.value);
  });
}

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return timestamp;
  }
  return value.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function setStatus(text, className) {
  smsStatus.textContent = text;
  smsStatus.className = className;
}

function isConfigured() {
  return CONFIG.appsScriptUrl && !CONFIG.appsScriptUrl.includes("PASTE_YOUR");
}

function friendlyError(error) {
  return error?.message || "Unknown error";
}
