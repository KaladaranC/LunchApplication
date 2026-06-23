# Daily Lunch Count Setup

This GitHub Pages site stores the shared lunch count in a Google Sheet through Google Apps Script.

## 1. Create the Google Sheet

1. Create a new Google Sheet.
2. Open `Extensions` > `Apps Script`.
3. Delete the starter code.
4. Paste the full contents of `apps-script.gs` into the editor.

## 2. Add the private TextBee values

In `apps-script.gs`, find `setupLunchCount()` and replace:

```js
TEXTBEE_API_KEY: "PASTE_TEXTBEE_API_KEY_HERE",
TEXTBEE_DEVICE_ID: "PASTE_TEXTBEE_DEVICE_ID_HERE",
CATERING_PHONE: "+94761962266",
```

The API key and device ID stay inside Apps Script, not in GitHub Pages.

## 3. Run setup once

1. In Apps Script, choose the `setupLunchCount` function.
2. Click `Run`.
3. Approve the requested permissions.

This creates the required sheets and installs the daily 8 AM trigger.

## 4. Deploy the web app

1. Click `Deploy` > `New deployment`.
2. Choose `Web app`.
3. Set `Execute as` to `Me`.
4. Set `Who has access` to `Anyone`.
5. Deploy and copy the web app URL.

## 5. Connect the GitHub Pages page

In `app.js`, replace:

```js
appsScriptUrl: "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE",
```

with the deployed Apps Script web app URL.

## Notes

- The page polls the shared sheet every 15 seconds, so visitors will see updates shortly after someone ticks a name.
- The SMS is sent by Apps Script at 8 AM Asia/Colombo time.
- The `Send SMS Now` button calls Apps Script and still keeps the TextBee credentials private.
