param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Tokn"),
  [switch]$NoAutoStart
)

$ErrorActionPreference = "Stop"

function Assert-SafeInstallDir {
  param([string]$TargetPath)

  $fullPath = [System.IO.Path]::GetFullPath($TargetPath)
  $localPrograms = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "Programs"))

  if (-not $fullPath.StartsWith($localPrograms, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Install directory must be inside $localPrograms. Got: $fullPath"
  }

  return $fullPath
}

function Stop-InstalledProcess {
  param([string]$TargetDir)

  $escapedDir = $TargetDir.Replace("\", "\\")
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.Name -eq "Tokn.exe" -or
      $_.ExecutablePath -like "$TargetDir*" -or
      $_.CommandLine -like "*$escapedDir*"
    } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Copy-AppPayload {
  param(
    [string]$SourceRoot,
    [string]$TargetAppDir
  )

  New-Item -ItemType Directory -Force -Path $TargetAppDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $SourceRoot "dist") -Destination (Join-Path $TargetAppDir "dist") -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $SourceRoot "dist-electron") -Destination (Join-Path $TargetAppDir "dist-electron") -Recurse -Force

  $packageJson = @'
{
  "name": "tokn",
  "productName": "Tokn",
  "version": "0.1.0",
  "main": "dist-electron/main.js",
  "type": "module"
}
'@

  Set-Content -LiteralPath (Join-Path $TargetAppDir "package.json") -Value $packageJson -Encoding UTF8
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$installRoot = Assert-SafeInstallDir -TargetPath $InstallDir
$electronDist = Join-Path $repoRoot "node_modules\electron\dist"
$targetExe = Join-Path $installRoot "Tokn.exe"
$targetAppDir = Join-Path $installRoot "resources\app"

if (-not (Test-Path -LiteralPath $electronDist)) {
  throw "Electron runtime not found at $electronDist. Run npm install first."
}

Push-Location $repoRoot
try {
  npm run build
} finally {
  Pop-Location
}

Stop-InstalledProcess -TargetDir $installRoot

if (Test-Path -LiteralPath $installRoot) {
  Remove-Item -LiteralPath $installRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $installRoot | Out-Null
Copy-Item -Path (Join-Path $electronDist "*") -Destination $installRoot -Recurse -Force

$electronExe = Join-Path $installRoot "electron.exe"
Rename-Item -LiteralPath $electronExe -NewName "Tokn.exe"
Copy-AppPayload -SourceRoot $repoRoot -TargetAppDir $targetAppDir

if (-not $NoAutoStart) {
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
  New-Item -Path $runKey -Force | Out-Null
  Set-ItemProperty -Path $runKey -Name "Tokn" -Value ('"' + $targetExe + '"')
}

Start-Process -FilePath $targetExe -WindowStyle Hidden

Write-Output "Installed Tokn to $installRoot"
Write-Output "Startup enabled: $($NoAutoStart -eq $false)"
