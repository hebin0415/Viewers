param(
    [string]$ConfigPath,
    [string]$ListenAddress = '127.0.0.1',
    [int]$Port = 8000,
    [string]$RuntimeHost = '127.0.0.1',
    [int]$NnUNetRuntimePort = 8101,
    [int]$YoloRuntimePort = 8102,
    [int]$MonaiRuntimePort = 8103,
    [string]$VenvPath = '.venv',
    [switch]$SkipImagePull,
    [switch]$SkipBackendStart,
    [switch]$CreateModelDirectories,
    [string]$NnUNetImage,
    [string]$NnUNetModelDir,
    [string]$NnUNetContainerArgsJson,
    [string]$NnUNetContainerModelDir = '/models',
    [string]$NnUNetEntryPoint,
    [string]$NnUNetInternalCommandJson,
    [string]$NnUNetExtraDockerArgsJson,
    [string]$NnUNetDevice,
    [string]$YoloImage,
    [string]$YoloModelDir,
    [string]$YoloContainerArgsJson,
    [string]$YoloContainerModelDir = '/models',
    [string]$YoloEntryPoint,
    [string]$YoloInternalCommandJson,
    [string]$YoloExtraDockerArgsJson,
    [string]$YoloDevice,
    [string]$MonaiImage,
    [string]$MonaiModelDir,
    [string]$MonaiContainerArgsJson,
    [string]$MonaiContainerModelDir = '/models',
    [string]$MonaiEntryPoint,
    [string]$MonaiInternalCommandJson,
    [string]$MonaiExtraDockerArgsJson,
    [string]$MonaiDevice,
    [string]$DicomwebRetrieveBaseUrl,
    [string]$DicomwebStowUrl,
    [string]$DicomwebHeadersJson,
    [string]$ArtifactsDir
)

$ErrorActionPreference = 'Stop'
$providedParameters = @{}
foreach ($parameterName in $PSBoundParameters.Keys) {
    $providedParameters[$parameterName] = $PSBoundParameters[$parameterName]
}

. (Join-Path $PSScriptRoot 'runtime-command-common.ps1')

function Get-ProvidedParameterValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [AllowNull()]$CurrentValue
    )

    if ($providedParameters.ContainsKey($Name)) {
        return $CurrentValue
    }

    return $null
}

function Resolve-ConfigPath {
    param(
        [string]$RequestedPath,
        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    if ([string]::IsNullOrWhiteSpace($RequestedPath)) {
        $defaultPath = Join-Path $ProjectRoot 'config\production-runtime.json'
        if (Test-Path $defaultPath) {
            return [System.IO.Path]::GetFullPath($defaultPath)
        }

        return $null
    }

    if ([System.IO.Path]::IsPathRooted($RequestedPath)) {
        return [System.IO.Path]::GetFullPath($RequestedPath)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot $RequestedPath))
}

function Get-ConfigNodeValue {
    param(
        [Parameter(Mandatory = $true)]
        [AllowNull()]$ConfigNode,
        [Parameter(Mandatory = $true)]
        [string[]]$PathSegments
    )

    $current = $ConfigNode
    foreach ($segment in $PathSegments) {
        if ($null -eq $current) {
            return $null
        }

        $property = $current.PSObject.Properties[$segment]
        if ($null -eq $property) {
            return $null
        }

        $current = $property.Value
    }

    return $current
}

function ConvertTo-JsonStringIfNeeded {
    param(
        [AllowNull()]$Value
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [string]) {
        return [string]$Value
    }

    return ($Value | ConvertTo-Json -Compress -Depth 20)
}

function Resolve-ConfiguredValue {
    param(
        [string]$ExplicitValue,
        [Parameter(Mandatory = $true)]
        [string]$EnvName,
        [AllowNull()]$ConfigValue,
        [string]$DefaultValue
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
        return $ExplicitValue
    }

    $envValue = Get-AiEnvValue -Name $EnvName
    if (-not [string]::IsNullOrWhiteSpace($envValue)) {
        return $envValue
    }

    $configString = ConvertTo-JsonStringIfNeeded -Value $ConfigValue
    if (-not [string]::IsNullOrWhiteSpace($configString)) {
        return $configString
    }

    return $DefaultValue
}

function Resolve-RequiredJsonArray {
    param(
        [string]$ExplicitValue,
        [Parameter(Mandatory = $true)]
        [string]$EnvName,
        [AllowNull()]$ConfigValue
    )

    $value = Resolve-ConfiguredValue -ExplicitValue $ExplicitValue -EnvName $EnvName -ConfigValue $ConfigValue
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "Set $EnvName or pass the matching script parameter."
    }

    $parsed = $value | ConvertFrom-Json
    if ($parsed -isnot [System.Collections.IEnumerable]) {
        throw "$EnvName must be a JSON array."
    }

    return ($parsed | ForEach-Object { [string]$_ }) | ConvertTo-Json -Compress
}

function Resolve-ModelDirectory {
    param(
        [string]$ExplicitValue,
        [Parameter(Mandatory = $true)]
        [string]$EnvName,
        [AllowNull()]$ConfigValue,
        [Parameter(Mandatory = $true)]
        [string]$DefaultPath,
        [Parameter(Mandatory = $true)]
        [string]$ConfigRoot,
        [switch]$AllowCreate
    )

    $resolved = Resolve-ConfiguredValue -ExplicitValue $ExplicitValue -EnvName $EnvName -ConfigValue $ConfigValue -DefaultValue $DefaultPath
    if (-not [System.IO.Path]::IsPathRooted($resolved)) {
        $resolved = Join-Path $ConfigRoot $resolved
    }
    $fullPath = [System.IO.Path]::GetFullPath($resolved)
    if (-not (Test-Path $fullPath)) {
        if ($AllowCreate.IsPresent) {
            New-Item -ItemType Directory -Force -Path $fullPath | Out-Null
        } else {
            throw "Model directory '$fullPath' was not found. Pass -CreateModelDirectories or set $EnvName to an existing path."
        }
    }

    return $fullPath
}

function Set-RuntimeDeploymentEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('nnunet', 'yolo', 'monai')]
        [string]$Family,
        [Parameter(Mandatory = $true)]
        [string]$Image,
        [Parameter(Mandatory = $true)]
        [string]$ModelDir,
        [Parameter(Mandatory = $true)]
        [string]$ContainerArgsJson,
        [Parameter(Mandatory = $true)]
        [string]$ContainerModelDir,
        [string]$EntryPoint,
        [string]$InternalCommandJson,
        [string]$ExtraDockerArgsJson,
        [string]$Device,
        [switch]$PullImage
    )

    $familyKey = $Family.ToUpper()
    Set-Item -Path "Env:AI_INFERENCE_${familyKey}_IMAGE" -Value $Image
    Set-Item -Path "Env:AI_INFERENCE_${familyKey}_MODEL_DIR" -Value $ModelDir
    Set-Item -Path "Env:AI_INFERENCE_${familyKey}_CONTAINER_ARGS_JSON" -Value $ContainerArgsJson
    Set-Item -Path "Env:AI_INFERENCE_${familyKey}_CONTAINER_MODEL_DIR" -Value $ContainerModelDir

    if ([string]::IsNullOrWhiteSpace($EntryPoint)) {
        Remove-Item "Env:AI_INFERENCE_${familyKey}_ENTRYPOINT" -ErrorAction SilentlyContinue
    } else {
        Set-Item -Path "Env:AI_INFERENCE_${familyKey}_ENTRYPOINT" -Value $EntryPoint
    }

    if ([string]::IsNullOrWhiteSpace($InternalCommandJson)) {
        Remove-Item "Env:AI_INFERENCE_${familyKey}_INTERNAL_COMMAND_JSON" -ErrorAction SilentlyContinue
    } else {
        Set-Item -Path "Env:AI_INFERENCE_${familyKey}_INTERNAL_COMMAND_JSON" -Value $InternalCommandJson
    }

    if ([string]::IsNullOrWhiteSpace($ExtraDockerArgsJson)) {
        Remove-Item "Env:AI_INFERENCE_${familyKey}_EXTRA_DOCKER_ARGS_JSON" -ErrorAction SilentlyContinue
    } else {
        Set-Item -Path "Env:AI_INFERENCE_${familyKey}_EXTRA_DOCKER_ARGS_JSON" -Value $ExtraDockerArgsJson
    }

    if ([string]::IsNullOrWhiteSpace($Device)) {
        Remove-Item "Env:AI_INFERENCE_${familyKey}_DEVICE" -ErrorAction SilentlyContinue
    } else {
        Set-Item -Path "Env:AI_INFERENCE_${familyKey}_DEVICE" -Value $Device
    }

    if ($PullImage.IsPresent) {
        & docker pull $Image
        if ($LASTEXITCODE -ne 0) {
            & docker image inspect $Image *> $null
            if ($LASTEXITCODE -ne 0) {
                throw "Unable to pull runtime image '$Image' and no matching local image exists."
            }

            Write-Warning "Skipping failed docker pull for '$Image' because a local image with the same tag already exists."
        }
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$backendStartScript = Join-Path $PSScriptRoot 'start.ps1'
$resolvedConfigPath = Resolve-ConfigPath -RequestedPath $ConfigPath -ProjectRoot $projectRoot
$deploymentConfig = $null
$configRoot = $projectRoot

if ($resolvedConfigPath) {
    if (-not (Test-Path $resolvedConfigPath)) {
        throw "Configuration file '$resolvedConfigPath' was not found."
    }

    $deploymentConfig = Get-Content -Raw -Path $resolvedConfigPath | ConvertFrom-Json
    $configRoot = Split-Path -Parent $resolvedConfigPath
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI was not found in PATH.'
}

$pullImages = -not $SkipImagePull.IsPresent

$nnunetImageValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetImage' -CurrentValue $NnUNetImage) -EnvName 'AI_INFERENCE_NNUNET_IMAGE' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'image'))
$nnunetModelDirValue = Resolve-ModelDirectory -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetModelDir' -CurrentValue $NnUNetModelDir) -EnvName 'AI_INFERENCE_NNUNET_MODEL_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'modelDir')) -DefaultPath (Join-Path $projectRoot 'models\nnunet') -ConfigRoot $configRoot -AllowCreate:$CreateModelDirectories.IsPresent
$nnunetArgsValue = Resolve-RequiredJsonArray -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetContainerArgsJson' -CurrentValue $NnUNetContainerArgsJson) -EnvName 'AI_INFERENCE_NNUNET_CONTAINER_ARGS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'containerArgs'))
$nnunetContainerModelDirValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetContainerModelDir' -CurrentValue $NnUNetContainerModelDir) -EnvName 'AI_INFERENCE_NNUNET_CONTAINER_MODEL_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'containerModelDir')) -DefaultValue '/models'
$nnunetEntryPointValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetEntryPoint' -CurrentValue $NnUNetEntryPoint) -EnvName 'AI_INFERENCE_NNUNET_ENTRYPOINT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'entryPoint'))
$nnunetInternalCommandValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetInternalCommandJson' -CurrentValue $NnUNetInternalCommandJson) -EnvName 'AI_INFERENCE_NNUNET_INTERNAL_COMMAND_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'internalCommand'))
$nnunetExtraDockerArgsValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetExtraDockerArgsJson' -CurrentValue $NnUNetExtraDockerArgsJson) -EnvName 'AI_INFERENCE_NNUNET_EXTRA_DOCKER_ARGS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'extraDockerArgs'))
$nnunetDeviceValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetDevice' -CurrentValue $NnUNetDevice) -EnvName 'AI_INFERENCE_NNUNET_DEVICE' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'nnunet', 'device'))

$yoloImageValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloImage' -CurrentValue $YoloImage) -EnvName 'AI_INFERENCE_YOLO_IMAGE' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'image'))
$yoloModelDirValue = Resolve-ModelDirectory -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloModelDir' -CurrentValue $YoloModelDir) -EnvName 'AI_INFERENCE_YOLO_MODEL_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'modelDir')) -DefaultPath (Join-Path $projectRoot 'models\yolo') -ConfigRoot $configRoot -AllowCreate:$CreateModelDirectories.IsPresent
$yoloArgsValue = Resolve-RequiredJsonArray -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloContainerArgsJson' -CurrentValue $YoloContainerArgsJson) -EnvName 'AI_INFERENCE_YOLO_CONTAINER_ARGS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'containerArgs'))
$yoloContainerModelDirValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloContainerModelDir' -CurrentValue $YoloContainerModelDir) -EnvName 'AI_INFERENCE_YOLO_CONTAINER_MODEL_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'containerModelDir')) -DefaultValue '/models'
$yoloEntryPointValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloEntryPoint' -CurrentValue $YoloEntryPoint) -EnvName 'AI_INFERENCE_YOLO_ENTRYPOINT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'entryPoint'))
$yoloInternalCommandValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloInternalCommandJson' -CurrentValue $YoloInternalCommandJson) -EnvName 'AI_INFERENCE_YOLO_INTERNAL_COMMAND_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'internalCommand'))
$yoloExtraDockerArgsValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloExtraDockerArgsJson' -CurrentValue $YoloExtraDockerArgsJson) -EnvName 'AI_INFERENCE_YOLO_EXTRA_DOCKER_ARGS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'extraDockerArgs'))
$yoloDeviceValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloDevice' -CurrentValue $YoloDevice) -EnvName 'AI_INFERENCE_YOLO_DEVICE' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'yolo', 'device'))

$monaiImageValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiImage' -CurrentValue $MonaiImage) -EnvName 'AI_INFERENCE_MONAI_IMAGE' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'image'))
$monaiModelDirValue = Resolve-ModelDirectory -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiModelDir' -CurrentValue $MonaiModelDir) -EnvName 'AI_INFERENCE_MONAI_MODEL_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'modelDir')) -DefaultPath (Join-Path $projectRoot 'models\monai') -ConfigRoot $configRoot -AllowCreate:$CreateModelDirectories.IsPresent
$monaiArgsValue = Resolve-RequiredJsonArray -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiContainerArgsJson' -CurrentValue $MonaiContainerArgsJson) -EnvName 'AI_INFERENCE_MONAI_CONTAINER_ARGS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'containerArgs'))
$monaiContainerModelDirValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiContainerModelDir' -CurrentValue $MonaiContainerModelDir) -EnvName 'AI_INFERENCE_MONAI_CONTAINER_MODEL_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'containerModelDir')) -DefaultValue '/models'
$monaiEntryPointValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiEntryPoint' -CurrentValue $MonaiEntryPoint) -EnvName 'AI_INFERENCE_MONAI_ENTRYPOINT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'entryPoint'))
$monaiInternalCommandValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiInternalCommandJson' -CurrentValue $MonaiInternalCommandJson) -EnvName 'AI_INFERENCE_MONAI_INTERNAL_COMMAND_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'internalCommand'))
$monaiExtraDockerArgsValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiExtraDockerArgsJson' -CurrentValue $MonaiExtraDockerArgsJson) -EnvName 'AI_INFERENCE_MONAI_EXTRA_DOCKER_ARGS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'extraDockerArgs'))
$monaiDeviceValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiDevice' -CurrentValue $MonaiDevice) -EnvName 'AI_INFERENCE_MONAI_DEVICE' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('runtimes', 'monai', 'device'))

Set-RuntimeDeploymentEnvironment -Family nnunet -Image $nnunetImageValue -ModelDir $nnunetModelDirValue -ContainerArgsJson $nnunetArgsValue -ContainerModelDir $nnunetContainerModelDirValue -EntryPoint $nnunetEntryPointValue -InternalCommandJson $nnunetInternalCommandValue -ExtraDockerArgsJson $nnunetExtraDockerArgsValue -Device $nnunetDeviceValue -PullImage:$pullImages
Set-RuntimeDeploymentEnvironment -Family yolo -Image $yoloImageValue -ModelDir $yoloModelDirValue -ContainerArgsJson $yoloArgsValue -ContainerModelDir $yoloContainerModelDirValue -EntryPoint $yoloEntryPointValue -InternalCommandJson $yoloInternalCommandValue -ExtraDockerArgsJson $yoloExtraDockerArgsValue -Device $yoloDeviceValue -PullImage:$pullImages
Set-RuntimeDeploymentEnvironment -Family monai -Image $monaiImageValue -ModelDir $monaiModelDirValue -ContainerArgsJson $monaiArgsValue -ContainerModelDir $monaiContainerModelDirValue -EntryPoint $monaiEntryPointValue -InternalCommandJson $monaiInternalCommandValue -ExtraDockerArgsJson $monaiExtraDockerArgsValue -Device $monaiDeviceValue -PullImage:$pullImages

Set-Item -Path 'Env:AI_INFERENCE_HOST' -Value (Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'ListenAddress' -CurrentValue $ListenAddress) -EnvName 'AI_INFERENCE_HOST' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'listenAddress')) -DefaultValue '127.0.0.1')
Set-Item -Path 'Env:AI_INFERENCE_PORT' -Value ([string](Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'Port' -CurrentValue ([string]$Port)) -EnvName 'AI_INFERENCE_PORT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'port')) -DefaultValue '8000'))
Set-Item -Path 'Env:AI_INFERENCE_MANAGED_RUNTIMES_ENABLED' -Value 'true'
Set-Item -Path 'Env:AI_INFERENCE_MANAGED_RUNTIME_HOST' -Value (Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'RuntimeHost' -CurrentValue $RuntimeHost) -EnvName 'AI_INFERENCE_MANAGED_RUNTIME_HOST' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'runtimeHost')) -DefaultValue '127.0.0.1')
Set-Item -Path 'Env:AI_INFERENCE_NNUNET_RUNTIME_PORT' -Value ([string](Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'NnUNetRuntimePort' -CurrentValue ([string]$NnUNetRuntimePort)) -EnvName 'AI_INFERENCE_NNUNET_RUNTIME_PORT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'runtimePorts', 'nnunet')) -DefaultValue '8101'))
Set-Item -Path 'Env:AI_INFERENCE_YOLO_RUNTIME_PORT' -Value ([string](Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'YoloRuntimePort' -CurrentValue ([string]$YoloRuntimePort)) -EnvName 'AI_INFERENCE_YOLO_RUNTIME_PORT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'runtimePorts', 'yolo')) -DefaultValue '8102'))
Set-Item -Path 'Env:AI_INFERENCE_MONAI_RUNTIME_PORT' -Value ([string](Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'MonaiRuntimePort' -CurrentValue ([string]$MonaiRuntimePort)) -EnvName 'AI_INFERENCE_MONAI_RUNTIME_PORT' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'runtimePorts', 'monai')) -DefaultValue '8103'))

Set-Item -Path 'Env:AI_INFERENCE_RUNTIME_SCRIPTS_DIR' -Value (Join-Path $projectRoot 'container-runtime')

$dicomRetrieveBaseUrlValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'DicomwebRetrieveBaseUrl' -CurrentValue $DicomwebRetrieveBaseUrl) -EnvName 'AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('dicomweb', 'retrieveBaseUrl'))
if (-not [string]::IsNullOrWhiteSpace($dicomRetrieveBaseUrlValue)) {
    Set-Item -Path 'Env:AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL' -Value $dicomRetrieveBaseUrlValue
}
$dicomStowUrlValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'DicomwebStowUrl' -CurrentValue $DicomwebStowUrl) -EnvName 'AI_INFERENCE_DICOMWEB_STOW_URL' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('dicomweb', 'stowUrl'))
if (-not [string]::IsNullOrWhiteSpace($dicomStowUrlValue)) {
    Set-Item -Path 'Env:AI_INFERENCE_DICOMWEB_STOW_URL' -Value $dicomStowUrlValue
}
$dicomHeadersValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'DicomwebHeadersJson' -CurrentValue $DicomwebHeadersJson) -EnvName 'AI_INFERENCE_DICOMWEB_HEADERS_JSON' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('dicomweb', 'headers'))
if (-not [string]::IsNullOrWhiteSpace($dicomHeadersValue)) {
    Set-Item -Path 'Env:AI_INFERENCE_DICOMWEB_HEADERS_JSON' -Value $dicomHeadersValue
}
$artifactsDirValue = Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'ArtifactsDir' -CurrentValue $ArtifactsDir) -EnvName 'AI_INFERENCE_ARTIFACTS_DIR' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'artifactsDir'))
if (-not [string]::IsNullOrWhiteSpace($artifactsDirValue)) {
    if (-not [System.IO.Path]::IsPathRooted($artifactsDirValue)) {
        $artifactsDirValue = Join-Path $configRoot $artifactsDirValue
    }

    Set-Item -Path 'Env:AI_INFERENCE_ARTIFACTS_DIR' -Value ([System.IO.Path]::GetFullPath($artifactsDirValue))
}

Write-Host 'Configured managed runtime deployment environment:'
Write-Host "  nnU-Net image: $nnunetImageValue"
Write-Host "  YOLO image:    $yoloImageValue"
Write-Host "  MONAI image:   $monaiImageValue"
Write-Host "  Backend:       http://$ListenAddress`:$Port"
Write-Host "  Runtime host:  $RuntimeHost"
if (-not [string]::IsNullOrWhiteSpace($dicomRetrieveBaseUrlValue)) {
    Write-Host "  DICOM retrieve: $dicomRetrieveBaseUrlValue"
}
if (-not [string]::IsNullOrWhiteSpace($dicomStowUrlValue)) {
    Write-Host "  DICOM STOW:     $dicomStowUrlValue"
}

if ($SkipBackendStart.IsPresent) {
    return
}

& $backendStartScript -ListenAddress (Get-AiEnvValue -Name 'AI_INFERENCE_HOST') -Port ([int](Get-AiEnvValue -Name 'AI_INFERENCE_PORT')) -VenvPath (Resolve-ConfiguredValue -ExplicitValue (Get-ProvidedParameterValue -Name 'VenvPath' -CurrentValue $VenvPath) -EnvName 'AI_INFERENCE_VENV_PATH' -ConfigValue (Get-ConfigNodeValue -ConfigNode $deploymentConfig -PathSegments @('backend', 'venvPath')) -DefaultValue '.venv')
