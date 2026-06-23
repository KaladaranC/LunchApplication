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

const SHEET_NAME = "Lunch Count";
const LOG_SHEET_NAME = "SMS Log";
const SCRIPT_TIME_ZONE = "Asia/Colombo";

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

    if (action === "resetToday") {
      return jsonResponse(resetToday());
    }

    if (action === "sendSms") {
      return jsonResponse(sendLunchSms());
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
    TEXTBEE_API_KEY: "4180b843-1871-48ad-ad18-0500b2fc91b5",
    TEXTBEE_DEVICE_ID: "6a3a6d6377015dcde10fe4a7",
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
  sendLunchSms();
}

function setSelection(name, selected) {
  if (!PEOPLE.includes(name)) {
    throw new Error("Unknown person: " + name);
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const sheet = ensureSheets().stateSheet;
    const date = todayKey();
    const rows = sheet.getDataRange().getValues();
    const rowIndex = findRowIndex(rows, date, name);
    const now = new Date();

    if (rowIndex === -1) {
      sheet.appendRow([date, name, Boolean(selected), now]);
    } else {
      sheet.getRange(rowIndex + 1, 3, 1, 2).setValues([[Boolean(selected), now]]);
    }

    return getTodayState();
  } finally {
    lock.releaseLock();
  }
}

function resetToday() {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);

  try {
    const sheet = ensureSheets().stateSheet;
    const date = todayKey();
    const rows = sheet.getDataRange().getValues();
    const now = new Date();

    PEOPLE.forEach((name) => {
      const rowIndex = findRowIndex(rows, date, name);
      if (rowIndex === -1) {
        sheet.appendRow([date, name, false, now]);
      } else {
        sheet.getRange(rowIndex + 1, 3, 1, 2).setValues([[false, now]]);
      }
    });

    setLastSentDate("");
    return getTodayState();
  } finally {
    lock.releaseLock();
  }
}

function getTodayState() {
  const sheet = ensureSheets().stateSheet;
  const date = todayKey();
  const rows = sheet.getDataRange().getValues();
  const selectedNames = rows
    .slice(1)
    .filter((row) => cellDateKey(row[0]) === date && row[2] === true)
    .map((row) => row[1])
    .filter((name) => PEOPLE.includes(name));

  return {
    ok: true,
    date,
    selectedNames: PEOPLE.filter((name) => selectedNames.includes(name)),
    lastSentDate: getLastSentDate(),
  };
}

function sendLunchSms() {
  const state = getTodayState();

  if (state.lastSentDate === state.date) {
    return { ...state, smsSkipped: true };
  }

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

  const message = "Lunch count for " + state.date + ": " + state.selectedNames.length + ".";
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
  logSms(state.date, state.selectedNames.length, message, statusCode, responseBody);

  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("TextBee returned HTTP " + statusCode + ": " + responseBody);
  }

  setLastSentDate(state.date);
  return getTodayState();
}

function ensureSheets() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const stateSheet = getOrCreateSheet(spreadsheet, SHEET_NAME, ["date", "name", "selected", "updatedAt"]);
  const logSheet = getOrCreateSheet(spreadsheet, LOG_SHEET_NAME, [
    "sentAt",
    "date",
    "count",
    "message",
    "statusCode",
    "response",
  ]);

  return { stateSheet, logSheet };
}

function getOrCreateSheet(spreadsheet, name, headers) {
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  return sheet;
}

function findRowIndex(rows, date, name) {
  return rows.findIndex((row, index) => index > 0 && cellDateKey(row[0]) === date && row[1] === name);
}

function todayKey(date) {
  return Utilities.formatDate(date || new Date(), SCRIPT_TIME_ZONE, "yyyy-MM-dd");
}

function cellDateKey(value) {
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return todayKey(value);
  }
  return String(value);
}

function getLastSentDate() {
  return PropertiesService.getScriptProperties().getProperty("LAST_SENT_DATE") || "";
}

function setLastSentDate(date) {
  PropertiesService.getScriptProperties().setProperty("LAST_SENT_DATE", date);
}

function logSms(date, count, message, statusCode, responseBody) {
  const sheet = ensureSheets().logSheet;
  sheet.appendRow([new Date(), date, count, message, statusCode, responseBody]);
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
