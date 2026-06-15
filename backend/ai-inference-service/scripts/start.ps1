param(
    [string]$ListenAddress = "127.0.0.1",
    [int]$Port = 8000,
    [switch]$Reload,
    [string]$VenvPath = ".venv"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonExe = Join-Path (Join-Path $projectRoot $VenvPath) "Scripts\python.exe"
$defaultConfigPath = Join-Path $projectRoot "config\production-runtime.json"

if (-not (Test-Path $pythonExe)) {
    throw "Virtual environment not found. Run scripts/install.ps1 first."
}

function Set-EnvIfMissing {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [AllowNull()]
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value) -or (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue)) {
        return
    }

    Set-Item -Path "Env:$Name" -Value $Value
}

function Resolve-ConfigPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ConfigRoot,
        [AllowNull()]
        [string]$ConfiguredPath
    )

    if ([string]::IsNullOrWhiteSpace($ConfiguredPath)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($ConfiguredPath)) {
        return [System.IO.Path]::GetFullPath($ConfiguredPath)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $ConfigRoot $ConfiguredPath))
}

function Set-JsonEnvIfMissing {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [AllowNull()]$Value
    )

    if ($null -eq $Value -or (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue)) {
        return
    }

    $serialized = if ($Value -is [string]) {
        [string]$Value
    } else {
        $Value | ConvertTo-Json -Compress -Depth 20
    }

    if (-not [string]::IsNullOrWhiteSpace($serialized)) {
        Set-Item -Path "Env:$Name" -Value $serialized
    }
}

if (Test-Path $defaultConfigPath) {
    $deploymentConfig = Get-Content -Raw -Path $defaultConfigPath | ConvertFrom-Json
    $configRoot = Split-Path -Parent $defaultConfigPath

    Set-EnvIfMissing -Name 'AI_INFERENCE_MANAGED_RUNTIME_HOST' -Value ([string]$deploymentConfig.backend.runtimeHost)
    Set-EnvIfMissing -Name 'AI_INFERENCE_NNUNET_RUNTIME_PORT' -Value ([string]$deploymentConfig.backend.runtimePorts.nnunet)
    Set-EnvIfMissing -Name 'AI_INFERENCE_YOLO_RUNTIME_PORT' -Value ([string]$deploymentConfig.backend.runtimePorts.yolo)
    Set-EnvIfMissing -Name 'AI_INFERENCE_MONAI_RUNTIME_PORT' -Value ([string]$deploymentConfig.backend.runtimePorts.monai)
    Set-EnvIfMissing -Name 'AI_INFERENCE_RUNTIME_SCRIPTS_DIR' -Value ([System.IO.Path]::GetFullPath((Join-Path $projectRoot 'container-runtime')))
    Set-EnvIfMissing -Name 'AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL' -Value ([string]$deploymentConfig.dicomweb.retrieveBaseUrl)
    Set-EnvIfMissing -Name 'AI_INFERENCE_DICOMWEB_STOW_URL' -Value ([string]$deploymentConfig.dicomweb.stowUrl)
    Set-JsonEnvIfMissing -Name 'AI_INFERENCE_DICOMWEB_HEADERS_JSON' -Value $deploymentConfig.dicomweb.headers

    $artifactsDir = Resolve-ConfigPath -ConfigRoot $configRoot -ConfiguredPath ([string]$deploymentConfig.backend.artifactsDir)
    Set-EnvIfMissing -Name 'AI_INFERENCE_ARTIFACTS_DIR' -Value $artifactsDir

    foreach ($family in @('nnunet', 'yolo', 'monai')) {
        $familyConfig = $deploymentConfig.runtimes.$family
        if ($null -eq $familyConfig) {
            continue
        }

        $familyKey = $family.ToUpper()
        Set-EnvIfMissing -Name "AI_INFERENCE_${familyKey}_IMAGE" -Value ([string]$familyConfig.image)
        Set-EnvIfMissing -Name "AI_INFERENCE_${familyKey}_MODEL_DIR" -Value (Resolve-ConfigPath -ConfigRoot $configRoot -ConfiguredPath ([string]$familyConfig.modelDir))
        Set-EnvIfMissing -Name "AI_INFERENCE_${familyKey}_CONTAINER_MODEL_DIR" -Value ([string]$familyConfig.containerModelDir)
        Set-JsonEnvIfMissing -Name "AI_INFERENCE_${familyKey}_CONTAINER_ARGS_JSON" -Value $familyConfig.containerArgs
        Set-JsonEnvIfMissing -Name "AI_INFERENCE_${familyKey}_INTERNAL_COMMAND_JSON" -Value $familyConfig.internalCommand
        Set-JsonEnvIfMissing -Name "AI_INFERENCE_${familyKey}_EXTRA_DOCKER_ARGS_JSON" -Value $familyConfig.extraDockerArgs
        Set-EnvIfMissing -Name "AI_INFERENCE_${familyKey}_ENTRYPOINT" -Value ([string]$familyConfig.entryPoint)
        Set-EnvIfMissing -Name "AI_INFERENCE_${familyKey}_DEVICE" -Value ([string]$familyConfig.device)
    }
}

$env:AI_INFERENCE_HOST = $ListenAddress
$env:AI_INFERENCE_PORT = [string]$Port
$env:AI_INFERENCE_RELOAD = $(if ($Reload.IsPresent) { "true" } else { "false" })
$env:AI_INFERENCE_MANAGED_RUNTIMES_ENABLED = "true"

if (-not $env:AI_INFERENCE_ORTHANC_BASE_URL) {
    $env:AI_INFERENCE_ORTHANC_BASE_URL = "http://127.0.0.1:8042"
}

if (-not $env:AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL) {
    $env:AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL = "$($env:AI_INFERENCE_ORTHANC_BASE_URL)/dicom-web"
}

if (-not $env:AI_INFERENCE_DICOMWEB_STOW_URL) {
    $env:AI_INFERENCE_DICOMWEB_STOW_URL = "$($env:AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL)/studies"
}

Push-Location $projectRoot
& $pythonExe -m app
Pop-Location
