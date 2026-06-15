param(
    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 8103,
    [string]$VenvPath = '.venv'
)

& (Join-Path $PSScriptRoot 'start-managed-runtime.ps1') -Family monai -HostAddress $HostAddress -Port $Port -VenvPath $VenvPath
