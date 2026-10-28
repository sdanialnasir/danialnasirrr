# Aqua Energizer - voice-over maker (ElevenLabs). Run it with make_voices.bat in the project folder.
#   1) Audition : renders the same sample line in every shortlisted voice -> voice-auditions\  (listen, pick two)
#   2) Make all : renders every line in tools\voices.json with your narrator + diver -> src\assets\vo\<id>.mp3, then rebuilds the game
#   3) Redo one : re-renders a single line (after you edit its text in tools\voices.json)
# Your API key is read from ELEVENLABS_API_KEY, or .elevenlabs-key in the project folder, or asked for (and optionally saved there).
param([string]$Mode = '')
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
# Two ways to run: inside the game project (tools\ folder: clips go to src\assets\vo and the game is rebuilt), or standalone from the
# extracted zip (everything in one folder: clips go to a 'voiceovers' folder next to this script, plus voiceovers.zip to send back).
$Here = $PSScriptRoot
$InRepo = Test-Path (Join-Path (Split-Path -Parent $Here) 'src\assets')
$Root = if ($InRepo) { Split-Path -Parent $Here } else { $Here }
$CfgPath = Join-Path $Here 'voices.json'
if (-not (Test-Path $CfgPath)) { throw "voices.json is missing. Keep it in the same folder as make_voices.ps1." }
$Cfg = Get-Content -Raw -Encoding UTF8 $CfgPath | ConvertFrom-Json
$Roles = @($Cfg.pick.PSObject.Properties.Name)  # narrator, diver, pip, shelly, murk, lumen, friend (one voice each)
$PickPath = Join-Path $Here 'voices.picked.json'
$KeyFile = Join-Path $Root '.elevenlabs-key'
$KeyTxt = Join-Path $Root 'elevenlabs-key.txt'
$VoDir = if ($InRepo) { Join-Path $Root 'src\assets\vo' } else { Join-Path $Root 'voiceovers' }
$AudDir = Join-Path $Root 'voice-auditions'
$Api = 'https://api.elevenlabs.io'

function Get-Key {
  if ($env:ELEVENLABS_API_KEY) { return $env:ELEVENLABS_API_KEY.Trim() }
  if (Test-Path $KeyFile) { return (Get-Content -Raw $KeyFile).Trim() }
  if (Test-Path $KeyTxt) { $t = (Get-Content -Raw $KeyTxt).Trim(); if ($t -and $t -notlike 'PASTE*') { return $t } }
  $k = (Read-Host 'Paste your ElevenLabs API key').Trim()
  if (-not $k) { throw 'No API key given.' }
  if ((Read-Host 'Save it in .elevenlabs-key for next time? (y/n)') -eq 'y') { Set-Content -NoNewline -Path $KeyFile -Value $k }
  return $k
}
$H = @{ 'xi-api-key' = (Get-Key) }

$script:Mine = $null
function Get-MyVoices { if ($null -eq $script:Mine) { $script:Mine = @((Invoke-RestMethod -Uri "$Api/v1/voices" -Headers $H).voices) }; return $script:Mine }

# name or id -> voice id: your voices (ElevenLabs' default voices are in there too), then the id we know, then the public Voice Library
function Resolve-Voice([string]$name, [string]$id) {
  if ($name -match '^[A-Za-z0-9]{20}$') { return $name }                       # a voice id was typed in
  $mine = Get-MyVoices
  $hit = $mine | Where-Object { $_.name -eq $name -or $_.name -like "$name *" -or $_.name -like "$name -*" } | Select-Object -First 1
  if ($hit) { return $hit.voice_id }
  if ($id -and ($mine | Where-Object { $_.voice_id -eq $id })) { return $id }
  try {
    $q = [uri]::EscapeDataString($name)
    $lib = @((Invoke-RestMethod -Uri "$Api/v1/shared-voices?search=$q&page_size=5" -Headers $H).voices) | Where-Object { $_.name -like "*$name*" } | Select-Object -First 1
    if ($lib) {
      Write-Host "  adding '$($lib.name)' from the Voice Library to your voices..." -ForegroundColor DarkGray
      $b = @{ new_name = $name } | ConvertTo-Json
      $r = Invoke-RestMethod -Method Post -Uri "$Api/v1/voices/add/$($lib.public_owner_id)/$($lib.voice_id)" -Headers $H -ContentType 'application/json' -Body $b
      $script:Mine = $null; return $r.voice_id
    }
  } catch { Write-Host "  library lookup for '$name' failed: $($_.ErrorDetails.Message)" -ForegroundColor Yellow }
  if ($id) { return $id }
  return $null
}

$Models = @($Cfg.model) + @($Cfg.fallback_models)
$script:Model = $null
function Speak([string]$voiceId, [string]$text, [string]$out, $settings) {
  $try = if ($script:Model) { @($script:Model) } else { $Models }
  foreach ($m in $try) {
    $t = $text
    if ($m -notin @('eleven_v3', 'eleven_v4')) { $t = ($text -replace '\[[^\]]*\]\s*', '').Trim() }   # older models would read the tags aloud
    $body = [System.Text.Encoding]::UTF8.GetBytes((@{ text = $t; model_id = $m; voice_settings = $settings } | ConvertTo-Json -Depth 5))
    $url = "$Api/v1/text-to-speech/$($voiceId)?output_format=$($Cfg.output_format)"
    try {
      Invoke-WebRequest -UseBasicParsing -Method Post -Uri $url -Headers $H -ContentType 'application/json; charset=utf-8' -Body $body -OutFile $out | Out-Null
      if (-not $script:Model) { $script:Model = $m; Write-Host "  (model: $m)" -ForegroundColor DarkGray }
      return $true
    } catch {
      $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
      if (Test-Path $out) { Remove-Item $out }
      if ($script:Model) { Write-Host "  failed: $msg" -ForegroundColor Red; return $false }
      Write-Host "  model $m didn't work ($msg), trying the next one" -ForegroundColor Yellow
    }
  }
  return $false
}

function Get-Picks {
  $p = [ordered]@{}; foreach ($r in $Roles) { $p[$r] = $Cfg.pick.$r }
  if (Test-Path $PickPath) { $s = Get-Content -Raw -Encoding UTF8 $PickPath | ConvertFrom-Json; foreach ($r in $Roles) { if ($s.$r) { $p[$r] = $s.$r } } }
  return $p
}
function Ask-Voices {
  $p = Get-Picks; $res = @{}
  foreach ($role in $Roles) {
    $in = (Read-Host "$role voice - a name from the shortlist or a voice ID  [Enter = $($p[$role])]").Trim()
    if ($in) { $p[$role] = $in }
    $cand = @($Cfg.candidates.$role) | Where-Object { $_.name -eq $p[$role] } | Select-Object -First 1
    $vid = Resolve-Voice $p[$role] $(if ($cand) { $cand.id } else { '' })
    if (-not $vid) { throw "Couldn't find a voice called '$($p[$role])'. Type its voice ID instead (ElevenLabs > Voices > ... > Copy voice ID)." }
    Write-Host "  $role = $($p[$role]) ($vid)" -ForegroundColor Cyan
    $res[$role] = $vid
  }
  ($p | ConvertTo-Json) | Set-Content -Encoding UTF8 $PickPath
  return $res
}

function Rebuild {
  if (-not $InRepo) {
    $zip = Join-Path $Root 'voiceovers.zip'; if (Test-Path $zip) { Remove-Item $zip }
    Compress-Archive -Path (Join-Path $VoDir '*.mp3') -DestinationPath $zip
    Write-Host "`nDone! Your clips are in the 'voiceovers' folder, and packed into voiceovers.zip. Send that zip back to put them in the game." -ForegroundColor Green
    try { Invoke-Item $Root } catch {}
    return
  }
  $py = Get-Command python -ErrorAction SilentlyContinue; if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
  if ($py) { Write-Host "`nRebuilding the game..." -ForegroundColor Cyan; & $py.Source (Join-Path $Root 'tools\build.py') }
  else { Write-Host "`nPython isn't installed here, so the game wasn't rebuilt. Commit src\assets\vo (or send the MP3s) and it gets built in." -ForegroundColor Yellow }
}

function Audition {
  New-Item -ItemType Directory -Force -Path $AudDir | Out-Null
  foreach ($role in $Roles) {
    Write-Host "`n$role voices:" -ForegroundColor Cyan
    foreach ($c in @($Cfg.candidates.$role)) {
      Write-Host ("  {0,-12} {1}" -f $c.name, $c.why)
      $vid = Resolve-Voice $c.name $c.id
      if (-not $vid) { Write-Host "    not available on this account, skipped" -ForegroundColor Yellow; continue }
      $out = Join-Path $AudDir ("{0}_{1}.mp3" -f $role, ($c.name -replace '[^A-Za-z0-9]', ''))
      if (Speak $vid $Cfg.audition.$role $out $Cfg.settings.$role) { Write-Host "    -> $out" -ForegroundColor Green }
    }
  }
  Write-Host "`nListen to them (ideally on your phone), then run this again and choose 2." -ForegroundColor Cyan
  try { Invoke-Item $AudDir } catch {}
}

function Make-All([bool]$redo) {
  $v = Ask-Voices; New-Item -ItemType Directory -Force -Path $VoDir | Out-Null
  $n = 0; $skip = 0; $fail = 0; $lines = @($Cfg.lines)
  foreach ($l in $lines) {
    $out = Join-Path $VoDir ($l.id + '.mp3')
    if ((Test-Path $out) -and -not $redo) { $skip++; continue }
    Write-Host ("[{0}/{1}] {2,-9} {3}" -f ($n + $skip + $fail + 1), $lines.Count, $l.id, $l.text)
    if (Speak $v[$l.role] $l.text $out $Cfg.settings.($l.role)) { $n++ } else { $fail++ }
  }
  Write-Host "`nMade $n, kept $skip existing, failed $fail." -ForegroundColor Cyan
  if ($n) { Rebuild }
}

function Redo-One {
  $id = (Read-Host 'Line id to redo (e.g. vo3, t1a, d_relic)').Trim()
  $l = @($Cfg.lines) | Where-Object { $_.id -eq $id } | Select-Object -First 1
  if (-not $l) { throw "No line with id '$id' in tools\voices.json." }
  $v = Ask-Voices; New-Item -ItemType Directory -Force -Path $VoDir | Out-Null
  $out = Join-Path $VoDir ($l.id + '.mp3')
  if (Speak $v[$l.role] $l.text $out $Cfg.settings.($l.role)) { Write-Host "-> $out" -ForegroundColor Green; Rebuild }
}

Write-Host "Aqua Energizer voice-overs  ($(@($Cfg.lines).Count) lines, model $($Cfg.model))" -ForegroundColor Cyan
if (-not $Mode) {
  Write-Host "  1) Audition the shortlisted voices (a few seconds each)"
  Write-Host "  2) Make all voice-overs (keeps lines that already exist)"
  Write-Host "  3) Remake ALL voice-overs (overwrites)"
  Write-Host "  4) Redo one line"
  $Mode = (Read-Host 'Choose 1-4').Trim()
}
switch ($Mode) { '1' { Audition } '2' { Make-All $false } '3' { Make-All $true } '4' { Redo-One } default { Write-Host 'Nothing chosen.' } }
