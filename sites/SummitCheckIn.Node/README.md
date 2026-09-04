# Summit Check-In — Node

This folder is a complete site: the Node server, Google Sheets integration, and static pages are all included. It uses only Node's built-in modules, so there are no packages to install.

## Run locally

Set the values shown in `.env.example` as environment variables, then run:

```powershell
npm start
```

Node does not automatically read `.env`; Azure App Service supplies these through **Settings → Environment variables**. For local PowerShell, set them with `$env:NAME = "value"` in the current terminal.

Required settings:

- `SUMMIT_ACCESS_PASSWORD`
- `SUMMIT_ADMIN_PASSWORD`
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`

The administrator password also grants normal check-in access. Share the Google Sheet with the service account's `client_email` as an Editor and enable the Google Sheets API for its Google Cloud project.

## Azure

Create a Node 22 Azure Web App, deploy this folder, and use `npm start` as the start command if Azure does not detect it automatically. Configure the four settings above and keep HTTPS Only enabled.

## Test

```powershell
npm test
```
