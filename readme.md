# Summit Leadership Check-In

- **site/**: ASP.NET Core / .NET 10 app deployed to Azure App Service.
- **appsScript/**: standalone static frontend with a Google Apps Script backend.
- **www-git-hub/**: public landing page redirecting to https://checkin.jdsoftwarellc.com/.

## Deployment

Push app changes to **main** to run [.github/workflows/azure-web.yml](.github/workflows/azure-web.yml).
It builds the C# app and deploys to **summit-checkin**. Deployment does not run tests.
A local commit alone does not trigger deployment. The workflow requires the one-time
publish-profile GitHub secret setup in [site/README.md](site/README.md).
Store the Azure publish profile in the AZURE_WEBAPP_PUBLISH_PROFILE repository secret.

To deploy manually, use **Actions > Deploy site to Azure > Run workflow** on main.

This workflow deploys only the C# app. It does not publish the GitHub Pages landing
page or the Apps Script edition; see [appsScript/README.md](appsScript/README.md)
for that edition's manual setup.

## Google Sheets

Keep these tabs and headers:

- Lists: Family Name, Member Name, type (Parent for parents)
- CheckIns: CheckInID, Timestamp, Family Name, Member Present, Notes

Both Thursday reports use recorded Thursdays in the current sheet without school-year
date limits. The parent report counts each parent's own attendance.

## Checks

```powershell
dotnet run --project tests/ParentReports.Tests.csproj
node tests/parent-reports.test.js
```

Add `?demo=1` to preview the C# site without Google Sheets access.
