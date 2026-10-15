param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$')][string]$Version,
  [ValidateSet('All','Backend','Web','Mini')][string]$Target = 'All',
  [string]$Description = 'Roadtrip release',
  [string]$WechatCli = '',
  [switch]$Execute,
  [switch]$ConsoleVerified,
  [switch]$DeviceVerified
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Push-Location $repo
try {
  & node scripts/release.mjs verify $Version
  if ($LASTEXITCODE -ne 0) { throw 'Release verification failed.' }
  $recordPath = Join-Path $repo "work/releases/$Version/release.json"
  $record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
  $environmentId = $record.target.environment
  if (!$WechatCli) {
    $found = Get-Command cli.bat -ErrorAction SilentlyContinue
    if ($found) { $WechatCli = $found.Source }
  }
  $steps = @()
  if ($Target -in @('All','Backend')) {
    $steps += @{ name='backend'; command=$WechatCli; arguments=@('cloud','functions','deploy','--env',$environmentId,'--names','api','--project',$repo,'--remote-npm-install') }
  }
  if ($Target -in @('All','Web')) {
    $tcb = Get-Command tcb.cmd -ErrorAction SilentlyContinue
    $steps += @{ name='web'; command=$(if ($tcb) { $tcb.Source } else { 'tcb.cmd' }); arguments=@('hosting','deploy',(Join-Path $repo "work/releases/$Version/web"),'-e',$environmentId) }
  }
  if ($Target -in @('All','Mini')) {
    $steps += @{ name='mini-upload'; command=$WechatCli; arguments=@('upload','--version',$Version,'--desc',$Description,'--project',$repo) }
  }
  foreach ($step in $steps) { Write-Host ($step.name + ': ' + $step.command + ' ' + ($step.arguments -join ' ')) }
  if (!$Execute) { Write-Host 'Preview only. Add -Execute -ConsoleVerified -DeviceVerified to deploy.'; return }
  if (!$ConsoleVerified -or !$DeviceVerified) { throw 'Record real console and device acceptance before deployment.' }
  foreach ($step in $steps) {
    if (!$step.command -or !(Get-Command $step.command -ErrorAction SilentlyContinue)) { throw "Missing tool for $($step.name). Install/login before deployment." }
  }
  $record.consoleAcceptance = 'operator-confirmed'
  $record.deviceAcceptance = 'operator-confirmed'
  $record | Add-Member -NotePropertyName operator -NotePropertyValue ([Environment]::UserName) -Force
  if (!$record.PSObject.Properties['steps']) { $record | Add-Member -NotePropertyName steps -NotePropertyValue @() }
  try {
    foreach ($step in $steps) {
      & node scripts/release.mjs verify $Version
      if ($LASTEXITCODE -ne 0) { throw 'Source changed before deployment.' }
      $record.deployment = "running:$($step.name)"
      $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $recordPath -Encoding UTF8
      $executable = $step.command
      $arguments = $step.arguments
      & $executable @arguments
      if ($LASTEXITCODE -ne 0) { throw "Deployment failed at $($step.name) (exit $LASTEXITCODE)." }
      $record.steps += @{ stage=$step.name; status='passed'; time=[DateTime]::UtcNow.ToString('o') }
    }
    $record.deployment = 'uploaded-awaiting-post-deploy-acceptance'
  } catch { $record.deployment = 'failed-or-partial'; throw }
  finally { $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $recordPath -Encoding UTF8 }
} finally { Pop-Location }
