param(
    [ValidateSet('all', 'nnunet', 'yolo', 'monai')]
    [string[]]$Family = @('all'),
    [string]$VenvPath = '.venv',
    [string]$IndexUrl = 'https://pypi.org/simple',
    [string]$PyTorchCpuIndexUrl = 'https://download.pytorch.org/whl/cpu',
    [string]$NnUNetImage = 'ohif-ai-nnunet-runtime:3.13.0-beta.87',
    [string]$YoloImage = 'ohif-ai-yolo-runtime:3.13.0-beta.87',
    [string]$MonaiImage = 'ohif-ai-monai-runtime:3.13.0-beta.87'
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$venvRoot = Join-Path $projectRoot $VenvPath
$pythonExe = Join-Path $venvRoot 'Scripts\python.exe'
$selectedFamilies = if ($Family -contains 'all') { @('nnunet', 'yolo', 'monai') } else { $Family }
$dockerAvailable = $false

try {
    & docker version *> $null
    $dockerAvailable = ($LASTEXITCODE -eq 0)
}
catch {
    $dockerAvailable = $false
}

if (-not $dockerAvailable -and -not (Test-Path $pythonExe)) {
    python -m venv $venvRoot
}

function Install-Packages {
    param(
        [string[]]$Packages,
        [string]$PackageIndexUrl = $IndexUrl,
        [string]$ExtraIndexUrl
    )

    $installArgs = @('-m', 'pip', 'install', '--index-url', $PackageIndexUrl)

    if ($ExtraIndexUrl) {
        $installArgs += @('--extra-index-url', $ExtraIndexUrl)
    }

    $installArgs += $Packages
    & $pythonExe @installArgs
}

function Install-TorchCpu {
    param([string[]]$Packages)

    Install-Packages -Packages $Packages -PackageIndexUrl $PyTorchCpuIndexUrl -ExtraIndexUrl $IndexUrl
}

function Invoke-DockerModelCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Image,
        [Parameter(Mandatory = $true)]
        [string]$HostModelDir,
        [string[]]$EnvironmentArgs = @(),
        [Parameter(Mandatory = $true)]
        [string[]]$CommandArgs
    )

    New-Item -ItemType Directory -Force -Path $HostModelDir | Out-Null
    $resolvedModelDir = (Resolve-Path $HostModelDir).ProviderPath
    $dockerArgs = @('run', '--rm', '-v', ('{0}:/models' -f $resolvedModelDir))

    if ($EnvironmentArgs.Count -gt 0) {
        $dockerArgs += $EnvironmentArgs
    }

    $dockerArgs += $Image
    $dockerArgs += $CommandArgs

    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Docker model bootstrap failed for $Image"
    }
}

if ($selectedFamilies -contains 'nnunet') {
    $nnunetModelDir = Join-Path $projectRoot 'models\nnunet'
    $totalsegHome = Join-Path $nnunetModelDir 'totalsegmentator-home'

    if ($dockerAvailable) {
        Invoke-DockerModelCommand `
            -Image $NnUNetImage `
            -HostModelDir $nnunetModelDir `
            -EnvironmentArgs @('-e', 'TOTALSEG_HOME_DIR=/models/totalsegmentator-home') `
            -CommandArgs @(
                'python',
                '-c',
                "import sys; from totalsegmentator.bin.totalseg_download_weights import main; sys.argv=['totalseg_download_weights','-t','total_fast']; main()"
            )
    }
    else {
        New-Item -ItemType Directory -Force -Path $totalsegHome | Out-Null
        Install-Packages -Packages @('TotalSegmentator==2.11.0', 'torch==2.5.1+cpu', 'torchvision==0.20.1+cpu') -ExtraIndexUrl $PyTorchCpuIndexUrl
        $env:TOTALSEG_HOME_DIR = $totalsegHome
        & $pythonExe -c "import sys; from totalsegmentator.bin.totalseg_download_weights import main; sys.argv=['totalseg_download_weights','-t','total_fast']; main()"
    }
}

if ($selectedFamilies -contains 'yolo') {
    $yoloModelPath = Join-Path $projectRoot 'models\yolo\yolo26n.pt'
    $yoloModelDir = Split-Path -Parent $yoloModelPath
    $totalsegMarker = Join-Path $totalsegHome '.weights-ready-total_fast'

    if ($dockerAvailable) {
        Invoke-DockerModelCommand `
            -Image $YoloImage `
            -HostModelDir $yoloModelDir `
            -CommandArgs @(
                'python',
                '-c',
                "from pathlib import Path; from ultralytics.utils.downloads import attempt_download_asset; target = Path('/models/yolo26n.pt'); target.parent.mkdir(parents=True, exist_ok=True); attempt_download_asset(target)"
            )
        New-Item -ItemType Directory -Force -Path $totalsegHome | Out-Null
        Set-Content -Path $totalsegMarker -Value 'ready' -Encoding utf8
    }
    else {
        New-Item -ItemType Directory -Force -Path $yoloModelDir | Out-Null
        Install-Packages -Packages @('ultralytics==8.4.62', 'torch==2.5.1+cpu', 'torchvision==0.20.1+cpu') -ExtraIndexUrl $PyTorchCpuIndexUrl
        & $pythonExe -c "import sys; from pathlib import Path; from ultralytics.utils.downloads import attempt_download_asset; target = Path(sys.argv[1]); target.parent.mkdir(parents=True, exist_ok=True); attempt_download_asset(target)" $yoloModelPath
        Set-Content -Path $totalsegMarker -Value 'ready' -Encoding utf8
    }
}

if ($selectedFamilies -contains 'monai') {
    $monaiModelDir = Join-Path $projectRoot 'models\monai'

    if ($dockerAvailable) {
        Invoke-DockerModelCommand `
            -Image $MonaiImage `
            -HostModelDir $monaiModelDir `
            -CommandArgs @('python', '-m', 'monai.bundle', 'download', 'spleen_ct_segmentation', '--bundle_dir', '/models')
    }
    else {
        New-Item -ItemType Directory -Force -Path $monaiModelDir | Out-Null
        Install-Packages -Packages @('monai[fire]==1.4.0', 'torch==2.5.1+cpu', 'numpy==1.26.4', 'requests==2.32.3') -ExtraIndexUrl $PyTorchCpuIndexUrl
        & $pythonExe -m monai.bundle download spleen_ct_segmentation --bundle_dir $monaiModelDir
    }
}
