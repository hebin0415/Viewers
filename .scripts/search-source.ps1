param(
  [Parameter(Mandatory = $true)]
  [string]$Pattern,

  [string[]]$Paths = @('tests', 'extensions', 'platform', 'modes', '.github', '.scripts', 'backend'),

  [string[]]$Include = @('*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.json', '*.md', '*.yml', '*.yaml', '*.ps1', '*.sh'),

  [string[]]$ExcludeDirectories = @(
    'node_modules',
    'dist',
    'coverage',
    '.git',
    '.nx',
    '.yarn',
    'artifacts',
    'test-results',
    'test-results-ai',
    'playwright-report',
    'playwright-report-ai'
  ),

  [int]$First = 120
)

$resolvedPaths = foreach ($path in $Paths) {
  if (Test-Path $path) {
    (Resolve-Path $path).Path
  }
}

if (-not $resolvedPaths) {
  throw 'No valid search paths were found.'
}

$files = Get-ChildItem -Path $resolvedPaths -Recurse -File -Include $Include -ErrorAction SilentlyContinue |
  Where-Object {
    foreach ($directoryName in $ExcludeDirectories) {
      if ($_.FullName -match "[\\/]$([Regex]::Escape($directoryName))([\\/]|$)") {
        return $false
      }
    }

    return $true
  }

$files |
  Select-String -Pattern $Pattern |
  Select-Object -First $First Path, LineNumber, Line |
  Format-Table -AutoSize |
  Out-String -Width 260
