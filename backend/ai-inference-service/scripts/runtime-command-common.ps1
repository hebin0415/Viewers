function Get-AiEnvValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $item = Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue
    if ($null -eq $item) {
        return $null
    }

    return [string]$item.Value
}

function ConvertTo-DockerHostPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PathValue
    )

    $resolved = [System.IO.Path]::GetFullPath($PathValue)
    if ($resolved.Length -ge 3 -and $resolved[1] -eq ':') {
        return ($resolved.Substring(0, 1).ToUpper() + ':' + $resolved.Substring(2).Replace('\', '/'))
    }

    return $resolved.Replace('\', '/')
}

function ConvertTo-ContainerReachableUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url
    )

    if ([string]::IsNullOrWhiteSpace($Url)) {
        return $Url
    }

    $uri = [System.Uri]$Url
    if ($uri.Host -notin @('127.0.0.1', 'localhost', '::1')) {
        return $Url
    }

    $builder = [System.UriBuilder]$uri
    $builder.Host = 'host.docker.internal'
    return $builder.Uri.AbsoluteUri.TrimEnd('/')
}

function Get-JsonArrayValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [switch]$Required
    )

    $raw = Get-AiEnvValue -Name $Name
    if ([string]::IsNullOrWhiteSpace($raw)) {
        if ($Required.IsPresent) {
            throw "Set $Name to a JSON command/args array."
        }

        return @()
    }

    $parsed = $raw | ConvertFrom-Json
    if ($parsed -isnot [System.Collections.IEnumerable]) {
        throw "$Name must be a JSON array."
    }

    $result = @()
    foreach ($item in $parsed) {
        $result += [string]$item
    }

    return $result
}

function Get-AiRuntimeCommandJson {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet('nnunet', 'yolo', 'monai')]
        [string]$Family,

        [Parameter(Mandatory = $true)]
        [string]$ProjectRoot
    )

    $familyKey = $Family.ToUpper()
    $imageEnv = "AI_INFERENCE_${familyKey}_IMAGE"
    $containerArgsEnv = "AI_INFERENCE_${familyKey}_CONTAINER_ARGS_JSON"
    $internalCommandEnv = "AI_INFERENCE_${familyKey}_INTERNAL_COMMAND_JSON"
    $extraDockerArgsEnv = "AI_INFERENCE_${familyKey}_EXTRA_DOCKER_ARGS_JSON"
    $entrypointEnv = "AI_INFERENCE_${familyKey}_ENTRYPOINT"
    $modelDirEnv = "AI_INFERENCE_${familyKey}_MODEL_DIR"
    $containerModelDirEnv = "AI_INFERENCE_${familyKey}_CONTAINER_MODEL_DIR"
    $deviceEnv = "AI_INFERENCE_${familyKey}_DEVICE"
    $runtimeScriptsDirEnv = "AI_INFERENCE_RUNTIME_SCRIPTS_DIR"

    $image = Get-AiEnvValue -Name $imageEnv
    if ([string]::IsNullOrWhiteSpace($image)) {
        throw "Set $imageEnv to the deployable Docker image for $Family runtime inference."
    }

    $containerArgs = Get-JsonArrayValue -Name $containerArgsEnv -Required
    $internalCommand = Get-AiEnvValue -Name $internalCommandEnv
    $extraDockerArgs = Get-JsonArrayValue -Name $extraDockerArgsEnv
    $entrypoint = Get-AiEnvValue -Name $entrypointEnv
    $hostModelDir = Get-AiEnvValue -Name $modelDirEnv
    if ([string]::IsNullOrWhiteSpace($hostModelDir)) {
        $hostModelDir = Join-Path $ProjectRoot (Join-Path 'models' $Family)
    }
    if (-not (Test-Path $hostModelDir)) {
        throw "Model directory '$hostModelDir' was not found. Set $modelDirEnv to a valid host path."
    }

    $containerModelDir = Get-AiEnvValue -Name $containerModelDirEnv
    if ([string]::IsNullOrWhiteSpace($containerModelDir)) {
        $containerModelDir = '/models'
    }

    $runtimeScriptsDir = Get-AiEnvValue -Name $runtimeScriptsDirEnv
    if ([string]::IsNullOrWhiteSpace($runtimeScriptsDir)) {
        $runtimeScriptsDir = Join-Path $ProjectRoot 'container-runtime'
    }
    if (-not (Test-Path $runtimeScriptsDir)) {
        throw "Runtime scripts directory '$runtimeScriptsDir' was not found. Set $runtimeScriptsDirEnv to a valid host path."
    }

    $dockerArgs = @(
        'docker',
        'run',
        '--rm',
        '--name',
        "ohif-ai-$Family-{inference_id}",
        '-v',
        "{work_dir_docker}:/runtime/work",
        '-v',
        "$(ConvertTo-DockerHostPath -PathValue $hostModelDir):$containerModelDir",
        '-v',
        "$(ConvertTo-DockerHostPath -PathValue $runtimeScriptsDir):/opt/ohif-runtime:ro",
        '-e',
        'AI_INFERENCE_REQUEST_JSON=/runtime/work/request.json',
        '-e',
        'AI_INFERENCE_RESPONSE_JSON=/runtime/work/response.json',
        '-e',
        "AI_INFERENCE_MODEL_DIR=$containerModelDir",
        '-e',
        'AI_INFERENCE_RUNTIME_SCRIPTS_DIR=/opt/ohif-runtime',
        '-e',
        'AI_INFERENCE_INFERENCE_ID={inference_id}',
        '-e',
        'AI_INFERENCE_MODEL_NAME={model_name}',
        '-e',
        'AI_INFERENCE_TASK_TYPE={task_type}',
        '-e',
        'AI_INFERENCE_STUDY_UID={study_uid}',
        '-e',
        'AI_INFERENCE_SERIES_UID={series_uid}'
    )

    $dicomRetrieveUrl = Get-AiEnvValue -Name 'AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL'
    if (-not [string]::IsNullOrWhiteSpace($dicomRetrieveUrl)) {
        $dockerArgs += @('-e', "AI_INFERENCE_DICOMWEB_RETRIEVE_BASE_URL=$(ConvertTo-ContainerReachableUrl -Url $dicomRetrieveUrl)")
    }

    $dicomStowUrl = Get-AiEnvValue -Name 'AI_INFERENCE_DICOMWEB_STOW_URL'
    if (-not [string]::IsNullOrWhiteSpace($dicomStowUrl)) {
        $dockerArgs += @('-e', "AI_INFERENCE_DICOMWEB_STOW_URL=$(ConvertTo-ContainerReachableUrl -Url $dicomStowUrl)")
    }

    $dicomHeaders = Get-AiEnvValue -Name 'AI_INFERENCE_DICOMWEB_HEADERS_JSON'
    if (-not [string]::IsNullOrWhiteSpace($dicomHeaders)) {
        $dockerArgs += @('-e', "AI_INFERENCE_DICOMWEB_HEADERS_JSON=$dicomHeaders")
    }

    $device = Get-AiEnvValue -Name $deviceEnv
    if (-not [string]::IsNullOrWhiteSpace($device)) {
        $dockerArgs += @('-e', "AI_INFERENCE_DEVICE=$device")
    }

    if (-not [string]::IsNullOrWhiteSpace($internalCommand)) {
        $dockerArgs += @('-e', "AI_INFERENCE_INTERNAL_COMMAND_JSON=$internalCommand")
        $dockerArgs += @('-e', "AI_INFERENCE_${familyKey}_INTERNAL_COMMAND_JSON=$internalCommand")
    }

    if ($entrypoint) {
        $dockerArgs += @('--entrypoint', $entrypoint)
    }

    if ($extraDockerArgs.Count -gt 0) {
        $dockerArgs += $extraDockerArgs
    }

    $dockerArgs += $image
    $dockerArgs += $containerArgs
    return $dockerArgs | ConvertTo-Json -Compress
}
