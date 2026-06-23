const CONFIG = {
  appsScriptUrl: "https://script.google.com/macros/s/AKfycby6iVheFBpNGT1sdSc05_MVdezyKoF97J8vsKY7gIM00YOgLpatpOAkjiPTUE5T0D4u/exec",
  pollIntervalMs: 15000,
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

let state = loadLocalState();
let isSaving = false;

renderPeople();
refreshView("Loading shared count...");
loadSharedState();
window.setInterval(loadSharedState, CONFIG.pollIntervalMs);

sendNowButton.addEventListener("click", sendLunchSms);
resetNowButton.addEventListener("click", resetToday);

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
  if (!isConfigured() || isSaving) {
    return;
  }

  try {
    const result = await callBackend("getState");
    applySharedState(result, "Shared count loaded");
  } catch (error) {
    setStatus(`Could not load shared count: ${friendlyError(error)}`, "is-error");
  }
}

async function updatePerson(name, selected) {
  const previousState = structuredClone(state);
  setSelectedName(name, selected);
  saveLocalState();
  syncCheckboxes();
  refreshView("Saving...");

  if (!isConfigured()) {
    setStatus("Add Apps Script URL first", "is-error");
    return;
  }

  try {
    isSaving = true;
    const result = await callBackend("setSelection", { name, selected });
    applySharedState(result, "Saved");
  } catch (error) {
    state = previousState;
    saveLocalState();
    syncCheckboxes();
    refreshView(`Save failed: ${friendlyError(error)}`, "is-error");
  } finally {
    isSaving = false;
  }
}

async function resetToday() {
  const previousState = structuredClone(state);
  state = freshState(todayKey());
  saveLocalState();
  syncCheckboxes();
  refreshView("Resetting...");

  if (!isConfigured()) {
    setStatus("Add Apps Script URL first", "is-error");
    return;
  }

  try {
    isSaving = true;
    const result = await callBackend("resetToday");
    applySharedState(result, "Reset");
  } catch (error) {
    state = previousState;
    saveLocalState();
    syncCheckboxes();
    refreshView(`Reset failed: ${friendlyError(error)}`, "is-error");
  } finally {
    isSaving = false;
  }
}

async function sendLunchSms() {
  if (!isConfigured()) {
    setStatus("Add Apps Script URL first", "is-error");
    return;
  }

  setStatus("Sending SMS...", "");

  try {
    const result = await callBackend("sendSms");
    applySharedState(result, "SMS sent");
  } catch (error) {
    setStatus(`SMS failed: ${friendlyError(error)}`, "is-error");
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

function applySharedState(result, message) {
  state = {
    date: result.date || todayKey(),
    selectedNames: Array.isArray(result.selectedNames) ? result.selectedNames : [],
    lastSentDate: result.lastSentDate || "",
  };
  saveLocalState();
  syncCheckboxes();
  refreshView(message);
}

function refreshView(message = "") {
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
  } else if (state.lastSentDate === todayKey()) {
    setStatus("SMS sent today", "");
  } else {
    setStatus("Waiting for Apps Script trigger", "");
  }
}

function setSelectedName(name, selected) {
  const selectedNames = new Set(state.selectedNames);
  if (selected) {
    selectedNames.add(name);
  } else {
    selectedNames.delete(name);
  }
  state.selectedNames = PEOPLE.filter((person) => selectedNames.has(person));
}

function loadLocalState() {
  const raw = localStorage.getItem(stateKey);
  if (!raw) {
    return freshState(todayKey());
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed.date !== todayKey()) {
      return freshState(todayKey());
    }
    return {
      date: parsed.date,
      selectedNames: Array.isArray(parsed.selectedNames) ? parsed.selectedNames : [],
      lastSentDate: parsed.lastSentDate || "",
    };
  } catch {
    return freshState(todayKey());
  }
}

function freshState(date) {
  return {
    date,
    selectedNames: [],
    lastSentDate: "",
  };
}

function saveLocalState() {
  localStorage.setItem(stateKey, JSON.stringify(state));
}

function resetIfNewDayLocally() {
  if (state.date !== todayKey()) {
    state = freshState(todayKey());
    saveLocalState();
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
