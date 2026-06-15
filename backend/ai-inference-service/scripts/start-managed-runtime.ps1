param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('nnunet', 'yolo', 'monai')]
    [string]$Family,

    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 8101,
    [string]$VenvPath = '.venv'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path (Join-Path $projectRoot $VenvPath) 'Scripts\python.exe'

if (-not (Test-Path $pythonExe)) {
    throw 'Virtual environment not found. Run scripts/install.ps1 first.'
}

. (Join-Path $PSScriptRoot 'runtime-command-common.ps1')

$familyKey = $Family.ToUpper()
$runtimeCommandEnv = "AI_INFERENCE_${familyKey}_RUNTIME_COMMAND"
if (-not (Get-AiEnvValue -Name $runtimeCommandEnv)) {
    Set-Item -Path "Env:$runtimeCommandEnv" -Value (Get-AiRuntimeCommandJson -Family $Family -ProjectRoot $projectRoot)
}

Push-Location $projectRoot
& $pythonExe -m app.runtime_server --family $Family --host $HostAddress --port $Port
Pop-Location
