# Summit Check-In — C#

This folder is a complete ASP.NET Core site. Its static pages are in `wwwroot`, and its small C# backend calls Google Sheets directly.

## Run locally

Copy `appsettings.Development.example.json` to `appsettings.Development.json`, fill in the four settings, then run:

```powershell
dotnet run
```

Share the Google Sheet with the service account's `client_email` as an Editor and enable the Google Sheets API for its Google Cloud project.

## Azure

### Direct deployment from your computer

For occasional releases, use the root PowerShell script instead of GitHub Actions.
Install the .NET 10 SDK and Azure CLI, then run from the repository root:

```powershell
.\deploy.ps1
```

It publishes the C# app, creates a ZIP in a fresh Git-ignored `.tmp` directory,
prompts for Azure sign-in if needed, and deploys to Web App `summit-checkin` in
resource group `summit-checkin`. Existing Azure environment settings are preserved.
The development settings file is excluded from the package.

Use `-Subscription 'your-subscription-id'` if you have multiple subscriptions.
You can override the target with `-ResourceGroup` and `-AppName`.
Use `.\deploy.ps1 -PackageOnly` to build the ZIP without signing in or deploying.
After deployment, open the printed site URL and test family loading and reports.
Repeat the command whenever you want to publish an update.

### GitHub Actions deployment (optional)

Deploy this folder from branch `compare-3-versions` using the repository's
[`azure-web.yml`](../../.github/workflows/azure-web.yml) workflow. It tests the site,
publishes this C# project, and deploys only the published output to Azure App Service.
Azure hosts a deployed copy of the app; it does not serve the GitHub folder directly.

### One-time Azure setup

1. Create an **Azure App Service Web App** with **Publish: Code**, **Operating System: Windows**,
   and **Runtime stack: .NET 10 (LTS)**. Choose a region and App Service plan appropriate
   for your budget. The workflow deploys to the production slot of this app.
2. Enable **HTTPS Only**. In **Settings > Environment variables**, add these app settings:

   | Name | Value |
   | --- | --- |
   | `Summit__AccessPassword` | Your check-in password |
   | `Summit__AdminPassword` | A different administrator password |
   | `Google__SpreadsheetId` | The ID from the Google Sheet URL |
   | `Google__ServiceAccountJson` | The complete service-account JSON key, as one setting |
   | `ASPNETCORE_ENVIRONMENT` | `Production` |

   Save the settings. Keep the service-account key and passwords out of GitHub.
   The administrator password also grants normal check-in access.
3. Configure App Service **Health check** with path `/api/health`. This checks whether
   the server is running; it does not test Google credentials or spreadsheet access.
   Enable **Always On** if supported by your plan.
4. Configure an Azure identity for GitHub Actions using
   [Microsoft's OpenID Connect setup](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions#generate-deployment-credentials).
   Grant the identity **Website Contributor** on this Web App. Its federated credential must use:

   - Issuer: `https://token.actions.githubusercontent.com`
   - Subject: `repo:jamesfdickinson/summit-attendance:ref:refs/heads/compare-3-versions`
   - Audience: `api://AzureADTokenExchange`

   This workflow uses a branch credential, with no GitHub environment attached to the job.

### Connect this repository and branch

In GitHub, open **Settings > Secrets and variables > Actions**:

- Add repository secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`
  using the values for the Azure identity/subscription configured above.
- Add repository **variable** `AZURE_WEBAPP_NAME` containing the exact Azure Web App name.
  Deployment is skipped until this variable exists; the build and tests still run.

Commit and push the workflow and project changes to `compare-3-versions`. Pushes affecting
the C# project, its tests, or this workflow trigger deployment. The workflow file stays
at the repository root under `.github/workflows`; its `dotnet publish` command selects
`sites/SummitCheckIn.Web/SummitCheckIn.Web.csproj` explicitly.

You can also connect **Deployment Center > GitHub** to repository
`jamesfdickinson/summit-attendance` and branch `compare-3-versions`. If the portal generates
another workflow, consolidate it with this one so only one workflow deploys to this app;
keep the explicit project path and the identity secret names consistent.

For a manual run, use **Actions > Deploy C# site to Azure App Service > Run workflow**
and select `compare-3-versions`. GitHub shows the manual-run control only once the workflow
also exists on the default branch. A relevant push to `compare-3-versions` works without that.
When changing deployment branches, update both workflow branch checks and the federated
credential subject.

### Verify the deployment

Use the default hostname shown on the Web App's Overview page:

- `/api/health` should return `{"ok":true}`.
- `/?demo=1` lets you review the frontend without accessing Google Sheets.
- `/` should accept the configured check-in password and load families from Google Sheets.
- `/admin.html` should accept the administrator password and load reports.

The Google Sheet must be shared with the service account as an Editor, with its required
tabs and headers described in the [root README](../../readme.md). A healthy server alone
does not confirm this integration works.

The deployment uses `dotnet publish` output, including `wwwroot` and the generated IIS
`web.config`. Development settings are excluded from publishing. No custom startup
command is needed for the Windows App Service configuration above.
