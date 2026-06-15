param(
    [string]$HostAddress = '127.0.0.1',
    [int]$Port = 8101,
    [string]$VenvPath = '.venv'
)

& (Join-Path $PSScriptRoot 'start-managed-runtime.ps1') -Family nnunet -HostAddress $HostAddress -Port $Port -VenvPath $VenvPath
