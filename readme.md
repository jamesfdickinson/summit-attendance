# Summit Leadership Check-In

## Overview

This project is a mobile-friendly web page that allows a parent to check in family members for Summit Leadership Academy. The design should closely match the reference images in `Screenshots`, using `images/logo.png` as the logo.

## Project files

- `www/` — the complete static website
- `www/config.js` — the deployed Apps Script URL
- `www/manifest.webmanifest` — installable app metadata
- `google-apps-script/Code.gs` — the bound Google Apps Script endpoint
- `google-apps-script/appsscript.json` — the Apps Script manifest
- `google-apps-script/SETUP.md` — deployment and connection instructions
- `tests/apps-script.test.js` — local tests for create, update, and validation behavior

## Check-in flow

1. The parent selects their family name.
2. The page displays the members associated with that family.
3. No family members are selected automatically. The parent selects everyone who is present each day. Submitting with no members selected is valid and records that no one from the family is present, allowing an incorrect attendance selection to be fully cleared.
4. The parent may add optional notes and submit the check-in.
5. After the check-in is saved, the form is replaced with a clean, full-page confirmation message.

The selected family name and the most recently downloaded family/member list are persisted in the browser with `localStorage`. On later visits, the cached list is displayed immediately while the site refreshes it from Google Sheets in the background.

If the app is closed or backgrounded from the confirmation screen, reopening it returns to a fresh form with the same remembered family already selected. The parent does not need to find their family again, and no members are preselected for the next submission.

## Same-day check-ins and edits

A family may have only one check-in row per day. A day is determined using the Google Sheet's configured timezone.

Selecting a family always starts with no members selected and blank notes; the site does not make a separate request to preload today's attendance. When the form is submitted, the endpoint finds that family's current-day check-in. If one exists, it overwrites that row instead of creating another row and retains its existing `CheckInID`.

## Google Sheets data

The Google Sheet is owned by the Summit organizers and remains private.

### `CheckIns` sheet

Columns:

- `CheckInID`
- `Timestamp`
- `Family Name`
- `Members Present`
- `Notes`

Each new check-in receives a random UUID for `CheckInID`.

### `Lists` sheet

Columns:

- `Family Name`
- `Member Name`

The family and member choices shown by the site come from this sheet.

## Google Apps Script endpoint

The project includes Google Apps Script source code and setup instructions. The sheet owner will copy the script into the Google Sheet's Apps Script project and deploy it as a web app.

The deployed endpoint acts as a limited bridge between the static site and the private Google Sheet. It supports only the operations required to:

- Read the family and member list
- Create a new check-in
- Update the family's existing check-in for the current day

The endpoint is publicly reachable because the site has no authentication or individual user accounts. The Google Sheet itself remains private, and the endpoint exposes only the limited operations listed above. Submitted families, members, notes, and other fields must be strictly validated by the script before any sheet data is returned or changed.

## Setup and preview

Follow [`google-apps-script/SETUP.md`](google-apps-script/SETUP.md) to connect and deploy the existing Google Sheet.

To preview the complete interface before connecting Google Apps Script, serve the project with any static HTTP server and open `/www/?demo=1`. Demo submissions stay in that browser's local storage and do not modify Google Sheets.

The normal `/www/` page does not use sample data. Until `www/config.js` contains a deployed Apps Script `/exec` URL, it displays a setup message instead of accepting check-ins.

Run the Apps Script behavior tests with:

```text
node tests/apps-script.test.js
```

## Stack

- Frontend: plain HTML, CSS, and JavaScript with no frameworks
- Hosting: static web hosting
- Installation: Progressive Web App (PWA) on supported phones and browsers
- Integration layer: Google Apps Script web app
- Database: Google Sheets
- Browser persistence: `localStorage` for the selected family and family/member list

On supported Android browsers, a small install icon appears only when the browser exposes a real installation prompt. The site never displays an automatic install banner. The icon remains hidden on iPhone because iOS does not allow a webpage button to directly trigger installation; users may still install manually from Safari's Share menu.
