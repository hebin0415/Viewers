param(
    [ValidateSet('all', 'nnunet', 'yolo', 'monai')]
    [string[]]$Family = @('all'),
    [string]$NnUNetTag = 'ohif-ai-nnunet-runtime:3.13.0-beta.87',
    [string]$YoloTag = 'ohif-ai-yolo-runtime:3.13.0-beta.87',
    [string]$MonaiTag = 'ohif-ai-monai-runtime:3.13.0-beta.87',
    [switch]$NoCache
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$selectedFamilies = if ($Family -contains 'all') { @('nnunet', 'yolo', 'monai') } else { $Family }

function Invoke-DockerBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ImageTag,
        [Parameter(Mandatory = $true)]
        [string]$DockerfilePath
    )

    $args = @('build', '-f', $DockerfilePath, '-t', $ImageTag)
    if ($NoCache.IsPresent) {
        $args += '--no-cache'
    }
    $args += $projectRoot

    & docker @args
    if ($LASTEXITCODE -ne 0) {
        throw "Docker build failed for $ImageTag"
    }
}

if ($selectedFamilies -contains 'nnunet') {
    Invoke-DockerBuild -ImageTag $NnUNetTag -DockerfilePath (Join-Path $projectRoot 'runtime-images\nnunet\Dockerfile')
}

if ($selectedFamilies -contains 'yolo') {
    Invoke-DockerBuild -ImageTag $YoloTag -DockerfilePath (Join-Path $projectRoot 'runtime-images\yolo\Dockerfile')
}

if ($selectedFamilies -contains 'monai') {
    Invoke-DockerBuild -ImageTag $MonaiTag -DockerfilePath (Join-Path $projectRoot 'runtime-images\monai\Dockerfile')
}
