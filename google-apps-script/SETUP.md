# Google Apps Script setup

The check-in page uses an Apps Script web app to read and update the private [Summit Google Sheet](https://docs.google.com/spreadsheets/d/1oSrf-rjjALNKfC8SonBctnBV4jY7QIv4zQerY3CF7V8/edit). Complete these steps using a Google account with edit access to the sheet.

## 1. Verify the sheet

Open the existing Summit spreadsheet and confirm it has these exact tab and column names:

- Tab `Lists`: `Family Name`, `Member Name`
- Tab `CheckIns`: `CheckInID`, `Timestamp`, `Family Name`, `Member Present`, `Notes`

Column order does not matter, but spelling and capitalization do.

In **File → Settings**, confirm the spreadsheet timezone is correct. Same-day check-ins use this timezone.

## 2. Add the script

1. In the spreadsheet, choose **Extensions → Apps Script**.
2. Replace the contents of `Code.gs` with the contents of this project's `Code.gs`.
3. Open **Project Settings**, enable **Show "appsscript.json" manifest file in editor**, and copy this project's `appsscript.json` into it. If the sheet is not in Pacific time, change the manifest timezone to match the spreadsheet.
4. Save the project.

Because the script is opened from the spreadsheet, it is bound to that spreadsheet; no spreadsheet ID needs to be copied into the code.

## 3. Deploy the web app

1. Click **Deploy → New deployment**.
2. Choose **Web app** as the deployment type.
3. Set **Execute as** to **Me**.
4. Set **Who has access** to **Anyone**.
5. Click **Deploy** and approve the requested Google Sheets permissions.
6. Copy the Web app URL ending in `/exec`.

Use the `/exec` deployment URL, not the temporary `/dev` test URL.

## 4. Connect the website

Open `www/config.js` and replace the placeholder with the deployment URL:

```js
window.SUMMIT_CONFIG = Object.freeze({
  API_URL: "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec"
});
```

Deploy the contents of `www` to any static web host.

## Updating the script later

Saving code in Apps Script does not update an existing deployment automatically:

1. Choose **Deploy → Manage deployments**.
2. Edit the active deployment.
3. Select **New version**.
4. Click **Deploy**.

The deployment URL normally remains the same.

The endpoint caches the `Lists` data and header locations for up to five minutes to reduce save time. Recent family-list edits may therefore take a few minutes to appear on the check-in page. Each selected member is stored on a separate `CheckIns` row. Re-submitting a family's attendance on the same day replaces all of that family's rows for the day while retaining the existing `CheckInID`.

## Local preview

Before the endpoint is configured, preview the complete interface with demo data by serving the project root and opening:

`http://localhost:8000/www/?demo=1`

Demo submissions are stored only in that browser's local storage and never reach Google Sheets.
