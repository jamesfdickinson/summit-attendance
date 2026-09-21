#Requires -Version 5.1
<#
.SYNOPSIS
Publishes and deploys the C# site to an existing Azure Web App.
.EXAMPLE
.\deploy.ps1
.EXAMPLE
.\deploy.ps1 -PackageOnly
.EXAMPLE
.\deploy.ps1 -Subscription 'your-subscription-id'
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'summit-checkin',
    [string]$AppName = 'summit-checkin',
    [string]$Subscription,
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (!(Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw 'Install the .NET 10 SDK before running this script.'
}
if (!$PackageOnly -and !(Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Install Azure CLI before running this script.'
}

$project = Join-Path $PSScriptRoot 'sites/SummitCheckIn.Web/SummitCheckIn.Web.csproj'
# A fresh directory prevents old files from leaking into a new deployment.
$outputRoot = Join-Path $PSScriptRoot ('.tmp/deploy-' + [guid]::NewGuid().ToString('N'))
$publishPath = Join-Path $outputRoot 'publish'
$zipPath = Join-Path $outputRoot 'summit-checkin.zip'
$null = New-Item -ItemType Directory -Path $publishPath -Force

Write-Host 'Publishing the C# site...'
& dotnet publish $project --configuration Release --output $publishPath
if ($LASTEXITCODE -ne 0) { throw 'Publish failed; nothing was deployed.' }

if (Get-ChildItem -LiteralPath $publishPath -Filter 'appsettings.Development*.json') {
    throw 'Development settings were found in the publish output; deployment stopped.'
}
foreach ($requiredFile in @('SummitCheckIn.Web.dll', 'web.config', 'wwwroot/index.html')) {
    if (!(Test-Path -LiteralPath (Join-Path $publishPath $requiredFile))) {
        throw "Publish output is missing $requiredFile; deployment stopped."
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($publishPath, $zipPath)
Write-Host "Package created: $zipPath"
if ($PackageOnly) { return }

# Windows PowerShell can turn native stderr into terminating errors.
# Treat a missing login as an expected condition so we can launch az login.
try {
    $ErrorActionPreference = 'Continue'
    & az account show --output none --only-show-errors 2>$null
    $signedIn = $LASTEXITCODE -eq 0
}
finally {
    $ErrorActionPreference = 'Stop'
}
if (!$signedIn) {
    Write-Host 'Sign in to Azure in the browser window...'
    & az login --output none --only-show-errors
    if ($LASTEXITCODE -ne 0) { throw 'Azure sign-in failed.' }
}

$scopeArgs = @()
if ($Subscription) { $scopeArgs = @('--subscription', $Subscription) }
$hostname = & az webapp show --resource-group $ResourceGroup --name $AppName @scopeArgs --query defaultHostName --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or !$hostname) {
    throw 'Cannot find the Web App. Check your account, subscription, resource group, and app name.'
}
$hostname = ($hostname -join '').Trim()
Write-Host "Deploying to $AppName in resource group $ResourceGroup ($hostname)..."
& az webapp deploy --resource-group $ResourceGroup --name $AppName @scopeArgs --src-path $zipPath --type zip --output none --only-show-errors
if ($LASTEXITCODE -ne 0) { throw 'Azure deployment failed. Review the Azure CLI error above.' }

Write-Host "Deployment finished. Open https://$hostname"
Write-Host "Server health: https://$hostname/api/health"
Write-Host 'The app uses its existing Azure environment settings. Test sign-in and family loading to verify Google Sheets access.'
