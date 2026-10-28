# Summit Check-In — C#

This folder is a complete ASP.NET Core site. Its static pages are in `wwwroot`, and its small C# backend calls Google Sheets directly.

## Parent attendance report

The admin page has a **Parent attendance** tab. In the existing `Lists` sheet,
add a `type` column and set each parent's row to `Parent` (case and surrounding
spaces are ignored). Each parent is matched by family and member name.

Both Thursday reports use all recorded Thursdays in the current sheet, without
calendar-year or school-year date limits. Percentages use distinct Thursdays with
CheckIns data. Any dated check-in row establishes a parent-report meeting, including
an empty attendance submission. Each parent can attend once per date; children
and other family members do not count for them. Parents with no attendance are
included. With no recorded Thursdays, the display shows N/A.
Use a fresh attendance sheet for a new school year. A school-year column is not
yet used as a filter.

Run report checks from the repository root:

```powershell
dotnet run --project tests/ParentReports.Tests.csproj
node tests/parent-reports.test.js
```

## Run locally

Copy `appsettings.Development.example.json` to `appsettings.Development.json`, fill in the four settings, then run:

```powershell
dotnet run
```

Share the Google Sheet with the service account's `client_email` as an Editor and enable the Google Sheets API for its Google Cloud project.

## Deploy automatically from GitHub

The workflow in [.github/workflows/azure-web.yml](../.github/workflows/azure-web.yml)
builds and deploys this app to Azure Web App **summit-checkin** when files in site/
or the workflow are pushed to **main**. A local commit alone does not
deploy; push it to GitHub. You can also run **Actions > Deploy site to Azure > Run
workflow** on main. No tests or separate deployment script run during deployment.

### One-time Azure/GitHub connection

The workflow uses a publish profile, following
[Microsoft's deployment guide](https://learn.microsoft.com/en-us/azure/app-service/deploy-github-actions).

1. In the Azure portal, open App Service **summit-checkin**. Under **Configuration >
   General settings**, enable **SCM Basic Auth Publishing Credentials** if disabled,
   and save. Azure requires this setting for publish-profile deployment.
2. On the app's **Overview** page, choose **Download publish profile**.
3. In GitHub repository **Settings > Secrets and variables > Actions**, choose
   **New repository secret**:
   - Name: AZURE_WEBAPP_PUBLISH_PROFILE
   - Value: the entire contents of the downloaded publish profile XML file.
4. Commit and push the workflow and app changes to main, then check the Actions run.

Keep the downloaded profile out of Git; store its contents only in the GitHub
secret. No Azure client ID, tenant ID, or subscription ID secrets are needed.
If the publishing credentials are reset, replace the GitHub secret with a freshly
downloaded profile.

Adding the workflow does not create the GitHub secret. Azure's existing app settings
are preserved. The app still needs Summit__AccessPassword, Summit__AdminPassword,
Google__SpreadsheetId, and Google__ServiceAccountJson set in Azure. Never commit
those values. The Google spreadsheet must be shared with the service account and
contain Lists and CheckIns tabs.

Development settings are excluded from the package. After deployment, verify
/api/health, check-in sign-in, family loading, and /admin.html. The health endpoint
alone does not verify Google Sheets access.
