# Summit Check-In — Google Apps Script

This folder is the standalone static-site version. The HTML, CSS, JavaScript, images, Apps Script backend, and setup instructions are all included together.

## Deploy

1. Follow [`apps-script/SETUP.md`](apps-script/SETUP.md) to copy `Code.gs` and `appsscript.json` into the Apps Script project bound to the Summit spreadsheet.
2. Add the basic-access password Script property.
3. Deploy a new Apps Script version and copy its `/exec` URL.
4. Put that URL in `public/config.js`.
5. Publish the contents of `public` with GitHub Pages or another static host.

The basic password is checked inside Apps Script. The administrator page uses a lightweight local browser password; it is not sent to or checked by Apps Script.

This means the administrator gate is only superficial: someone who knows the Apps Script URL can call the reports operation directly. The Google Sheet itself remains private.

This edition requires no Azure server or service account. Its tradeoff is the occasional delay caused by Apps Script startup and its redirecting web-app response.

## Preview

The admin **Parent attendance** tab uses the `Lists` sheet's `type` column:
mark each parent `Parent`. It shows a percentage per parent using all Thursdays with CheckIns data in the
current sheet, without date limits. The family Thursday report also uses all years.
Repeated rows count once per parent/date, and parents without attendance remain
listed. No recorded Thursdays displays N/A. Deploy both the updated frontend
and a new Apps Script version to enable this report.

Serve the `public` folder with any static web server and add `?demo=1` to the URL. Demo mode does not access Google Sheets.
