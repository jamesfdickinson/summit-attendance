# Summit Leadership Check-In

The project now includes three complete, self-contained versions of the same site:

- `sites/SummitCheckIn.Web/` — simple ASP.NET Core / C# site
- `sites/SummitCheckIn.Node/` — simple Node 22 site with no package dependencies
- `sites/SummitCheckIn.AppsScript/` — static site plus its Google Apps Script backend

Each folder contains its own static check-in and administrator pages. The C# and Node folders deploy independently to Azure App Service and call Google Sheets directly. The Apps Script folder deploys the frontend to GitHub Pages and uses its included Apps Script backend.

The former root `www/` and `google-apps-script/` folders have been removed from the project layout.

## Shared attendance behavior

- The basic password grants check-in access.
- Families are cached for five minutes.
- Same-day family submissions replace the existing rows atomically.
- Visitor retries use stable submission IDs.
- The browser can confirm a save if the original response is interrupted.

In the C# and Node versions, the administrator password is server-validated, grants both access levels, and protects reports. In the Apps Script version, the administrator password is a superficial local browser gate and is not sent to Apps Script.

## Google setup for C# and Node

1. Enable the Google Sheets API in a Google Cloud project.
2. Create a service account and download its JSON key.
3. Share the Summit spreadsheet with the service account's `client_email` as an **Editor**.
4. Keep these exact tabs and headers:
   - `Lists`: `Family Name`, `Member Name`
   - `CheckIns`: `CheckInID`, `Timestamp`, `Family Name`, `Member Present`, `Notes`

The spreadsheet remains private. The selected server is the only component that receives the service-account key.

## C# version

See [`sites/SummitCheckIn.Web/README.md`](sites/SummitCheckIn.Web/README.md).

Azure hosting is prepared with [a GitHub Actions workflow](.github/workflows/azure-web.yml)
targeting branch `compare-3-versions` and the C# project folder. Follow the C# README's
one-time Azure and GitHub setup to enable deployment.

```powershell
cd sites/SummitCheckIn.Web
dotnet run
```

Azure settings:

- `Summit__AccessPassword`
- `Summit__AdminPassword`
- `Google__SpreadsheetId`
- `Google__ServiceAccountJson`

## Node version

See [`sites/SummitCheckIn.Node/README.md`](sites/SummitCheckIn.Node/README.md).

```powershell
cd sites/SummitCheckIn.Node
npm start
```

Azure settings:

- `SUMMIT_ACCESS_PASSWORD`
- `SUMMIT_ADMIN_PASSWORD`
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

## Google Apps Script version

See [`sites/SummitCheckIn.AppsScript/README.md`](sites/SummitCheckIn.AppsScript/README.md).

This version does not need Azure or a service account. It needs the `SUMMIT_ACCESS_PASSWORD` Script property and the deployed `/exec` URL in `public/config.js`. Its administrator password is stored in the frontend for a lightweight local gate.

## Verification

```powershell
node sites/SummitCheckIn.Node/test.js
dotnet run --project sites/SummitCheckIn.Web.Tests/SummitCheckIn.Web.Tests.csproj --no-build
node tests/pwa.test.js
node tests/admin.test.js
```

Add `?demo=1` to any site's home-page URL to use demo data without accessing Google Sheets.
