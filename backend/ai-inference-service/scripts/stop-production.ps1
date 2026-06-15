param(
    [int[]]$Ports = @(8000, 8101, 8102, 8103),
    [string[]]$ContainerNamePrefixes = @('ohif-ai-nnunet-', 'ohif-ai-yolo-', 'ohif-ai-monai-'),
    [switch]$StopOrthanc
)

$ErrorActionPreference = 'Stop'

function Get-ListeningProcessIds {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$TargetPorts
    )

    $processIds = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($targetPort in $TargetPorts) {
        $connections = Get-NetTCPConnection -LocalPort $targetPort -State Listen -ErrorAction SilentlyContinue
        foreach ($connection in $connections) {
            [void]$processIds.Add([int]$connection.OwningProcess)
        }
    }

    return $processIds
}

function Stop-ListeningProcesses {
    param(
        [Parameter(Mandatory = $true)]
        [int[]]$TargetPorts
    )

    $processIds = Get-ListeningProcessIds -TargetPorts $TargetPorts
    foreach ($processId in $processIds) {
        if ($processId -le 0 -or $processId -eq $PID) {
            continue
        }

        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            continue
        }

        Write-Host "Stopping process $($process.ProcessName) (PID $processId)"
        Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    }
}

function Stop-InferenceContainers {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Prefixes
    )

    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        return
    }

    & cmd.exe /c "docker version >nul 2>nul"
    if ($LASTEXITCODE -ne 0) {
        Write-Warning 'Docker daemon is not reachable; skipping runtime container cleanup.'
        return
    }

    $containerNames = @()
    foreach ($prefix in $Prefixes) {
        $matches = & docker ps -a --filter "name=$prefix" --format "{{.Names}}"
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to query Docker containers.'
        }

        if ($matches) {
            $containerNames += $matches
        }
    }

    $uniqueContainerNames = $containerNames | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    foreach ($containerName in $uniqueContainerNames) {
        Write-Host "Removing container $containerName"
        & docker rm -f $containerName | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to remove Docker container '$containerName'."
        }
    }

    if ($StopOrthanc.IsPresent) {
        $orthancExists = & docker ps -a --filter "name=orthanc" --format "{{.Names}}"
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to query Orthanc container.'
        }

        if ($orthancExists -contains 'orthanc') {
            Write-Host 'Stopping Orthanc container orthanc'
            & docker rm -f orthanc | Out-Null
            if ($LASTEXITCODE -ne 0) {
                throw "Failed to remove Docker container 'orthanc'."
            }
        }
    }
}

Stop-ListeningProcesses -TargetPorts $Ports
Stop-InferenceContainers -Prefixes $ContainerNamePrefixes

Write-Host 'AI inference production processes and runtime containers have been stopped.'
