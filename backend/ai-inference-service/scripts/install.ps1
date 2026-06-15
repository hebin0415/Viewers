param(
    [string]$VenvPath = ".venv",
    [string]$IndexUrl = "https://pypi.org/simple"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvRoot = Join-Path $projectRoot $VenvPath
$pythonExe = Join-Path $venvRoot "Scripts\python.exe"

Push-Location $projectRoot

if (-not (Test-Path $pythonExe)) {
    python -m venv $VenvPath
}

$pipArgs = @("--index-url", $IndexUrl)

& $pythonExe -m pip install @pipArgs --upgrade pip setuptools wheel
& $pythonExe -m pip install @pipArgs -r requirements.txt

Pop-Location
