param(
    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 8102,
    [string]$VenvPath = '.venv'
)

& (Join-Path $PSScriptRoot 'start-managed-runtime.ps1') -Family yolo -HostAddress $HostAddress -Port $Port -VenvPath $VenvPath
