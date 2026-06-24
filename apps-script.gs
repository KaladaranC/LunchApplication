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

const SHEET_NAME = "Lunch State";
const LOG_SHEET_NAME = "SMS Log";
const SCRIPT_TIME_ZONE = "Asia/Colombo";
const STATE_HEADERS = [
  "date",
  "selectedNamesJson",
  "extraCurryPortion",
  "budgetFriendly",
  "updatedAt",
  "lastManualSentAt",
  "lastScheduledSentAt",
];
const LOG_HEADERS = ["sentAt", "date", "kind", "count", "message", "statusCode", "response"];

function doPost(event) {
  try {
    const request = JSON.parse(event.postData.contents || "{}");
    const action = request.action || "getState";

    if (action === "getState") {
      return jsonResponse(getTodayState());
    }

    if (action === "setSelection") {
      return jsonResponse(setSelection(request.name, request.selected));
    }

    if (action === "setOption") {
      return jsonResponse(setOption(request.option, request.value));
    }

    if (action === "resetToday") {
      return jsonResponse(resetToday());
    }

    if (action === "sendSms") {
      return jsonResponse(sendSms("manual"));
    }

    throw new Error("Unknown action: " + action);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function doGet() {
  return jsonResponse(getTodayState());
}

function setupLunchCount() {
  ensureSheets();
  PropertiesService.getScriptProperties().setProperties({
    TEXTBEE_API_KEY: "PASTE_TEXTBEE_API_KEY_HERE",
    TEXTBEE_DEVICE_ID: "PASTE_TEXTBEE_DEVICE_ID_HERE",
    CATERING_PHONE: "+94761962266",
  });

  ScriptApp.getProjectTriggers()
    .filter((trigger) => trigger.getHandlerFunction() === "scheduledSendLunchSms")
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger("scheduledSendLunchSms")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .nearMinute(0)
    .inTimezone(SCRIPT_TIME_ZONE)
    .create();
}

function scheduledSendLunchSms() {
  const today = todayKey();
  if (getLastScheduledSentDate() === today) {
    return;
  }

  sendSms("scheduled");
  setLastScheduledSentDate(today);
}

function setSelection(name, selected) {
  if (!PEOPLE.includes(name)) {
    throw new Error("Unknown person: " + name);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const current = getCurrentState();
    const selectedNames = new Set(current.selectedNames);
    if (selected) {
      selectedNames.add(name);
    } else {
      selectedNames.delete(name);
    }

    return saveState({
      date: todayKey(),
      selectedNames: PEOPLE.filter((person) => selectedNames.has(person)),
      extraCurryPortion: current.extraCurryPortion,
      budgetFriendly: current.budgetFriendly,
      updatedAt: new Date().toISOString(),
      lastManualSentAt: current.lastManualSentAt,
      lastScheduledSentAt: current.lastScheduledSentAt,
    });
  } finally {
    lock.releaseLock();
  }
}

function setOption(option, value) {
  const allowedOptions = ["extraCurryPortion", "budgetFriendly"];
  if (!allowedOptions.includes(option)) {
    throw new Error("Unknown option: " + option);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const current = getCurrentState();
    return saveState({
      date: todayKey(),
      selectedNames: current.selectedNames,
      extraCurryPortion: option === "extraCurryPortion" ? Boolean(value) : current.extraCurryPortion,
      budgetFriendly: option === "budgetFriendly" ? Boolean(value) : current.budgetFriendly,
      updatedAt: new Date().toISOString(),
      lastManualSentAt: current.lastManualSentAt,
      lastScheduledSentAt: current.lastScheduledSentAt,
    });
  } finally {
    lock.releaseLock();
  }
}

function resetToday() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    return saveState({
      date: todayKey(),
      selectedNames: [],
      extraCurryPortion: false,
      budgetFriendly: false,
      updatedAt: new Date().toISOString(),
      lastManualSentAt: "",
      lastScheduledSentAt: "",
    });
  } finally {
    lock.releaseLock();
  }
}

function sendSms(kind) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const current = getCurrentState();
    const properties = PropertiesService.getScriptProperties();
    const apiKey = properties.getProperty("TEXTBEE_API_KEY");
    const deviceId = properties.getProperty("TEXTBEE_DEVICE_ID");
    const cateringPhone = properties.getProperty("CATERING_PHONE");

    if (!apiKey || apiKey.includes("PASTE_")) {
      throw new Error("Missing TEXTBEE_API_KEY in Script Properties");
    }
    if (!deviceId || deviceId.includes("PASTE_")) {
      throw new Error("Missing TEXTBEE_DEVICE_ID in Script Properties");
    }
    if (!cateringPhone) {
      throw new Error("Missing CATERING_PHONE in Script Properties");
    }

    const count = getLunchCount(current);
    const message = buildMessage(current.date, count, current.extraCurryPortion);
    const response = UrlFetchApp.fetch(
      "https://api.textbee.dev/api/v1/gateway/devices/" + encodeURIComponent(deviceId) + "/send-sms",
      {
        method: "post",
        contentType: "application/json",
        headers: {
          "x-api-key": apiKey,
        },
        payload: JSON.stringify({
          recipients: [cateringPhone],
          message,
        }),
        muteHttpExceptions: true,
      },
    );

    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();
    logSms({
      sentAt: new Date(),
      date: current.date,
      kind,
      count,
      message,
      statusCode,
      response: responseBody,
    });

    if (statusCode < 200 || statusCode >= 300) {
      throw new Error("TextBee returned HTTP " + statusCode + ": " + responseBody);
    }

    const updatedAt = new Date().toISOString();
    if (kind === "manual") {
      return saveState({
        date: current.date,
        selectedNames: current.selectedNames,
        extraCurryPortion: current.extraCurryPortion,
        budgetFriendly: current.budgetFriendly,
        updatedAt,
        lastManualSentAt: updatedAt,
        lastScheduledSentAt: current.lastScheduledSentAt,
      });
    }

    return saveState({
      date: current.date,
      selectedNames: current.selectedNames,
      extraCurryPortion: current.extraCurryPortion,
      budgetFriendly: current.budgetFriendly,
      updatedAt,
      lastManualSentAt: current.lastManualSentAt,
      lastScheduledSentAt: updatedAt,
    });
  } finally {
    lock.releaseLock();
  }
}

function getTodayState() {
  const current = getCurrentState();
  return {
    ok: true,
    date: current.date,
    selectedNames: current.selectedNames,
    extraCurryPortion: current.extraCurryPortion,
    budgetFriendly: current.budgetFriendly,
    updatedAt: current.updatedAt,
    lastManualSentAt: current.lastManualSentAt,
    lastScheduledSentAt: current.lastScheduledSentAt,
  };
}

function getCurrentState() {
  const sheet = ensureStateSheet();
  const rows = sheet.getDataRange().getValues();
  const today = todayKey();
  const row = rows.find((value, index) => index > 0 && String(value[0]) === today);

  if (!row) {
    return {
      date: today,
      selectedNames: [],
      extraCurryPortion: false,
      budgetFriendly: false,
      updatedAt: "",
      lastManualSentAt: "",
      lastScheduledSentAt: "",
    };
  }

  if (isLegacyStateRow(row)) {
    return {
      date: String(row[0]),
      selectedNames: parseSelectedNames(row[1]),
      extraCurryPortion: false,
      budgetFriendly: false,
      updatedAt: row[2] ? toIsoString(row[2]) : "",
      lastManualSentAt: row[3] ? toIsoString(row[3]) : "",
      lastScheduledSentAt: row[4] ? toIsoString(row[4]) : "",
    };
  }

  return {
    date: String(row[0]),
    selectedNames: parseSelectedNames(row[1]),
    extraCurryPortion: parseBoolean(row[2]),
    budgetFriendly: parseBoolean(row[3]),
    updatedAt: row[4] ? toIsoString(row[4]) : "",
    lastManualSentAt: row[5] ? toIsoString(row[5]) : "",
    lastScheduledSentAt: row[6] ? toIsoString(row[6]) : "",
  };
}

function saveState(state) {
  const sheet = ensureStateSheet();
  const rows = sheet.getDataRange().getValues();
  const today = todayKey();
  const rowIndex = rows.findIndex((value, index) => index > 0 && String(value[0]) === today);
  const row = [
    state.date || today,
    JSON.stringify(state.selectedNames || []),
    Boolean(state.extraCurryPortion),
    Boolean(state.budgetFriendly),
    state.updatedAt || "",
    state.lastManualSentAt || "",
    state.lastScheduledSentAt || "",
  ];

  if (rowIndex === -1) {
    sheet.appendRow(row);
  } else {
    sheet.getRange(rowIndex + 1, 1, 1, STATE_HEADERS.length).setValues([row]);
  }

  return getTodayState();
}

function ensureSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const stateSheet = getOrCreateSheet(spreadsheet, SHEET_NAME, STATE_HEADERS);
  const logSheet = getOrCreateSheet(spreadsheet, LOG_SHEET_NAME, LOG_HEADERS);
  return { stateSheet, logSheet };
}

function ensureStateSheet() {
  return ensureSheets().stateSheet;
}

function getOrCreateSheet(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  } else {
    const currentHeaders = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    if (headers.some((header, index) => currentHeaders[index] !== header)) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function parseSelectedNames(raw) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed.filter((name) => PEOPLE.includes(name)) : [];
  } catch {
    return [];
  }
}

function parseBoolean(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function isBooleanCell(value) {
  return value === true || value === false || String(value).toLowerCase() === "true" || String(value).toLowerCase() === "false";
}

function isLegacyStateRow(row) {
  return row.length < STATE_HEADERS.length || (row[2] && !isBooleanCell(row[2])) || (row[3] && !isBooleanCell(row[3]));
}

function getLunchCount(state) {
  const selectedCount = state.selectedNames.length;
  if (state.budgetFriendly && selectedCount > 2) {
    return selectedCount - 1;
  }
  return selectedCount;
}

function buildMessage(date, count, extraCurryPortion) {
  return [
    "Lunch count: " + count,
    "Extra curry portion: " + (extraCurryPortion ? 1 : 0),
    date,
  ].join("\n");
}

function logSms(entry) {
  const sheet = ensureSheets().logSheet;
  sheet.appendRow([
    entry.sentAt,
    entry.date,
    entry.kind,
    entry.count,
    entry.message,
    entry.statusCode,
    entry.response,
  ]);
}

function todayKey(date) {
  return Utilities.formatDate(date || new Date(), SCRIPT_TIME_ZONE, "yyyy-MM-dd");
}

function toIsoString(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return value.toISOString();
  }
  return String(value);
}

function getLastScheduledSentDate() {
  return PropertiesService.getScriptProperties().getProperty("LAST_SCHEDULED_SENT_DATE") || "";
}

function setLastScheduledSentDate(date) {
  PropertiesService.getScriptProperties().setProperty("LAST_SCHEDULED_SENT_DATE", date);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
