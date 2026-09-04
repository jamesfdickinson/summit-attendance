# Summit Check-In — C#

This folder is a complete ASP.NET Core site. Its static pages are in `wwwroot`, and its small C# backend calls Google Sheets directly.

## Run locally

Copy `appsettings.Development.example.json` to `appsettings.Development.json`, fill in the four settings, then run:

```powershell
dotnet run
```

Share the Google Sheet with the service account's `client_email` as an Editor and enable the Google Sheets API for its Google Cloud project.

## Azure

Deploy this folder to a .NET 10 Azure Web App. Configure:

- `Summit__AccessPassword`
- `Summit__AdminPassword`
- `Google__SpreadsheetId`
- `Google__ServiceAccountJson`

Keep HTTPS Only enabled. The administrator password also grants normal check-in access.
