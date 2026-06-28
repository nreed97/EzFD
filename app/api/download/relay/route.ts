import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Generates a single self-contained .bat file that embeds a PowerShell
// ADIF-watcher script. Double-clicking it on any Windows 10/11 machine
// will start relaying WSJT-X / JTDX QSOs to this EzFD server.
// No installation required -- PowerShell is built into Windows.

export async function GET(request: NextRequest) {
  const { searchParams, protocol, host } = request.nextUrl;

  const joinCode = (searchParams.get('join_code') ?? searchParams.get('event_id') ?? '').toUpperCase();
  const operator = searchParams.get('operator')   ?? '';
  const station  = searchParams.get('station')    ?? '1';
  const apiUrl   = searchParams.get('api_url')    ?? `${protocol}//${host}`;

  if (!joinCode) {
    return NextResponse.json({ error: 'join_code required' }, { status: 400 });
  }

  const content = buildBatFile(joinCode, apiUrl, operator, parseInt(station, 10) || 1);

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="ezfd-wsjt-relay.bat"',
      'Cache-Control': 'no-store',
    },
  });
}

function buildBatFile(joinCode: string, apiUrl: string, operator: string, station: number): string {
  const ps = buildPsScript(joinCode, apiUrl, operator, station);

  const bat = [
    '@echo off',
    'title EzFD WSJT-X Relay',
    'echo.',
    'echo  EzFD is ready to receive your digital QSOs.',
    'echo  Leave this window open while you operate.',
    'echo  Close it when you are done for the session.',
    'echo.',
    'set "SELF=%~f0"',
    'set "TF=%TEMP%\\ezfd-relay.ps1"',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^',
    '  "$c=[IO.File]::ReadAllText($env:SELF,[Text.Encoding]::UTF8);$i=$c.IndexOf(\'#ezfd-ps-start#\');[IO.File]::WriteAllText($env:TF,$c.Substring($i+15),[Text.Encoding]::UTF8)"',
    'if %errorlevel% neq 0 (',
    '  echo.',
    '  echo  ERROR: Could not start relay. Try downloading again from EzFD.',
    '  pause',
    '  exit /b 1',
    ')',
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%TF%"',
    'del "%TF%" 2>nul',
    'echo.',
    'echo  Relay stopped.',
    'pause',
    'exit /b',
    '',
    '#ezfd-ps-start#',
    ps,
  ].join('\r\n');

  return bat;
}

// ------------------------------------------------------------------
// PowerShell 5.1-compatible ADIF file watcher.
//
// CRITICAL: this function must emit ONLY printable ASCII characters.
// No Unicode box-drawing, curly quotes, or em-dashes. The BAT file
// is read back with ReadAllText and any non-ASCII chars corrupt the
// encoding, turning curly quotes into garbage that breaks PS parsing.
//
// All PS single-quoted strings use the Q constant (ASCII 0x27) so
// editors cannot silently substitute smart/curly quotes.
// ------------------------------------------------------------------
function buildPsScript(joinCode: string, apiUrl: string, operator: string, station: number): string {
  const safeCode = joinCode.replace(/'/g, "''");
  const safeUrl  = apiUrl.replace(/'/g, "''");
  const safeOp   = operator.replace(/'/g, "''");

  // ASCII 0x27 straight single quote -- never auto-converted by editors.
  const Q = '\x27';

  // Build each line explicitly so no template-literal curly-quote substitution
  // can sneak in from an editor with smart-quote correction enabled.
  const L = [
    '# EzFD WSJT-X Relay -- auto-generated, do not edit',
    '$JoinCode     = ' + Q + safeCode + Q,
    '$ApiUrl       = ' + Q + safeUrl  + Q,
    '$OperatorCall = ' + Q + safeOp  + Q,
    '$StationNum   = ' + String(station),
    '',
    '# Search order: WSJT-X local, WSJT-X roaming, JTDX local, JTDX roaming',
    '$LogCandidates = @(',
    '    "$env:LOCALAPPDATA\\WSJT-X\\wsjtx_log.adi"',
    '    "$env:APPDATA\\WSJT-X\\wsjtx_log.adi"',
    '    "$env:LOCALAPPDATA\\JTDX\\jtdx_log.adi"',
    '    "$env:APPDATA\\JTDX\\jtdx_log.adi"',
    ')',
    '',
    '# -- helpers --------------------------------------------------',
    '',
    'function Get-AdifFields($record) {',
    '    $fields = @{}',
    '    $ms = [regex]::Matches($record, ' + Q + '<([A-Z0-9_]+):(\\d+)(?::[^>]+)?>' + Q + ', ' + Q + 'IgnoreCase' + Q + ')',
    '    foreach ($m in $ms) {',
    '        $name  = $m.Groups[1].Value.ToUpper()',
    '        $len   = [int]$m.Groups[2].Value',
    '        $start = $m.Index + $m.Length',
    '        if (($start + $len) -le $record.Length) {',
    '            $fields[$name] = $record.Substring($start, $len)',
    '        }',
    '    }',
    '    return $fields',
    '}',
    '',
    'function Get-Band($band, $freq) {',
    '    if ($band) {',
    '        $b = ([string]$band).ToLower().Trim()',
    '        if (@(' + [
      '160m','80m','40m','20m','15m','10m','6m','2m','1.25m','70cm',
    ].map(b => Q + b + Q).join(',') + ') -contains $b) { return $b }',
    '    }',
    '    if ($freq) {',
    '        $n = 0.0',
    '        if ([double]::TryParse([string]$freq, [ref]$n)) {',
    '            $k = $n * 1000',
    '            if ($k -ge 1800  -and $k -lt 2000)    { return ' + Q + '160m' + Q + ' }',
    '            if ($k -ge 3500  -and $k -lt 4000)    { return ' + Q + '80m'  + Q + '  }',
    '            if ($k -ge 7000  -and $k -lt 7300)    { return ' + Q + '40m'  + Q + '  }',
    '            if ($k -ge 14000 -and $k -lt 14350)   { return ' + Q + '20m'  + Q + '  }',
    '            if ($k -ge 21000 -and $k -lt 21450)   { return ' + Q + '15m'  + Q + '  }',
    '            if ($k -ge 28000 -and $k -lt 29700)   { return ' + Q + '10m'  + Q + '  }',
    '            if ($k -ge 50000 -and $k -lt 54000)   { return ' + Q + '6m'   + Q + '   }',
    '            if ($k -ge 144000 -and $k -lt 148000) { return ' + Q + '2m'   + Q + '   }',
    '        }',
    '    }',
    '    return $null',
    '}',
    '',
    'function Get-Mode($mode) {',
    '    $m = ([string]$mode).ToUpper().Trim()',
    '    if ($m -eq ' + Q + 'CW' + Q + ') { return ' + Q + 'CW' + Q + ' }',
    '    if (@(' + ['SSB','USB','LSB','FM','AM'].map(m => Q + m + Q).join(',') + ') -contains $m) { return ' + Q + 'PH' + Q + ' }',
    '    return ' + Q + 'DIG' + Q,
    '}',
    '',
    'function Build-SentSet($content) {',
    '    $set = @{}',
    '    foreach ($rec in ($content -split ' + Q + '(?i)<EOR>' + Q + ')) {',
    '        $f    = Get-AdifFields $rec',
    '        $call = ([string]$f[' + Q + 'CALL' + Q + ']).Trim().ToUpper()',
    '        if (-not $call) { continue }',
    '        $band = Get-Band ([string]$f[' + Q + 'BAND' + Q + ']) ([string]$f[' + Q + 'FREQ' + Q + '])',
    '        if (-not $band) { continue }',
    '        $mode = Get-Mode ([string]$f[' + Q + 'MODE' + Q + '])',
    '        $set["$call|$band|$mode"] = $true',
    '    }',
    '    return $set',
    '}',
    '',
    'function Send-Qso($call, $band, $mode, $rcvdClass, $rcvdSection) {',
    '    $body = @{',
    '        join_code      = $JoinCode',
    '        callsign       = $call',
    '        band           = $band',
    '        mode           = $mode',
    '        rcvd_class     = $rcvdClass',
    '        rcvd_section   = $rcvdSection',
    '        operator_call  = $OperatorCall',
    '        station_number = $StationNum',
    '    } | ConvertTo-Json -Compress',
    '',
    '    try {',
    '        $r = Invoke-RestMethod `',
    '            -Uri "$ApiUrl/api/qso" `',
    '            -Method Post `',
    '            -Body $body `',
    '            -ContentType ' + Q + 'application/json' + Q + ' `',
    '            -TimeoutSec 10 `',
    '            -ErrorAction Stop',
    '',
    '        if ($r.is_dupe) {',
    '            Write-Host "  $(Get-Date -F ' + Q + 'HH:mm' + Q + ')  $($call.PadRight(12)) $($band.PadRight(6)) $mode  already in log" -ForegroundColor Yellow',
    '        } else {',
    '            Write-Host "  $(Get-Date -F ' + Q + 'HH:mm' + Q + ')  $($call.PadRight(12)) $($band.PadRight(6)) $mode  logged!" -ForegroundColor Green',
    '        }',
    '    } catch {',
    '        Write-Host "  $(Get-Date -F ' + Q + 'HH:mm' + Q + ')  $($call.PadRight(12)) $($band.PadRight(6)) $mode  ERROR: $($_.Exception.Message)" -ForegroundColor Red',
    '    }',
    '}',
    '',
    'function Process-Log($content, $sentSet) {',
    '    foreach ($rec in ($content -split ' + Q + '(?i)<EOR>' + Q + ')) {',
    '        $f    = Get-AdifFields $rec',
    '        $call = ([string]$f[' + Q + 'CALL' + Q + ']).Trim().ToUpper()',
    '        if (-not $call) { continue }',
    '',
    '        $band = Get-Band ([string]$f[' + Q + 'BAND' + Q + ']) ([string]$f[' + Q + 'FREQ' + Q + '])',
    '        if (-not $band) { continue }',
    '',
    '        $mode = Get-Mode ([string]$f[' + Q + 'MODE' + Q + '])',
    '        $key  = "$call|$band|$mode"',
    '        if ($sentSet.ContainsKey($key)) { continue }',
    '        $sentSet[$key] = $true',
    '',
    '        $rcvdClass   = ([string]$f[' + Q + 'CLASS'    + Q + ']).Trim().ToUpper()',
    '        $rcvdSection = ([string]$f[' + Q + 'ARRL_SECT' + Q + ']).Trim().ToUpper()',
    '        if (-not $rcvdSection) { $rcvdSection = ([string]$f[' + Q + 'STATE' + Q + ']).Trim().ToUpper() }',
    '',
    '        if ((-not $rcvdClass -or -not $rcvdSection) -and $f[' + Q + 'SRX_STRING' + Q + ']) {',
    '            $parts = ([string]$f[' + Q + 'SRX_STRING' + Q + ']).Trim() -split ' + Q + '\\s+' + Q,
    '            if ($parts.Count -ge 2) {',
    '                if (-not $rcvdClass)   { $rcvdClass   = $parts[0].ToUpper() }',
    '                if (-not $rcvdSection) { $rcvdSection = $parts[1].ToUpper() }',
    '            }',
    '        }',
    '',
    '        Send-Qso $call $band $mode $rcvdClass $rcvdSection',
    '    }',
    '}',
    '',
    '# -- main -----------------------------------------------------',
    '',
    'Write-Host ""',
    'Write-Host "  ================================================" -ForegroundColor Cyan',
    'Write-Host "    EzFD  WSJT-X / JTDX  Relay" -ForegroundColor Cyan',
    'Write-Host "  ================================================" -ForegroundColor Cyan',
    'Write-Host "  Server:   $ApiUrl" -ForegroundColor DarkGray',
    'Write-Host "  Event:    $JoinCode" -ForegroundColor DarkGray',
    'if ($OperatorCall) {',
    '    Write-Host "  Operator: $OperatorCall" -ForegroundColor DarkGray',
    '}',
    'Write-Host ""',
    '',
    '$LogFile = $null',
    'foreach ($p in $LogCandidates) {',
    '    if (Test-Path $p) { $LogFile = $p; break }',
    '}',
    '',
    'if ($LogFile) {',
    '    Write-Host "  Log file: $LogFile" -ForegroundColor DarkGray',
    '    Write-Host ""',
    '} else {',
    '    Write-Host "  Waiting for WSJT-X to create its log file..." -ForegroundColor Yellow',
    '    Write-Host "  (Start WSJT-X and log at least one QSO)" -ForegroundColor DarkGray',
    '    Write-Host ""',
    '    $LogFile = $LogCandidates[0]',
    '    $dir = Split-Path $LogFile',
    '    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }',
    '    while (-not (Test-Path $LogFile)) { Start-Sleep -Seconds 2 }',
    '    Write-Host "  Found: $LogFile" -ForegroundColor Green',
    '    Write-Host ""',
    '}',
    '',
    '$sent = @{}',
    'try {',
    '    $existing = [IO.File]::ReadAllText($LogFile)',
    '    $sent = Build-SentSet $existing',
    '    if ($sent.Count -gt 0) {',
    '        Write-Host "  Skipping $($sent.Count) QSO(s) already in the log." -ForegroundColor DarkGray',
    '        Write-Host ""',
    '    }',
    '} catch { }',
    '',
    'Write-Host "  Watching for new QSOs  (Ctrl-C or close window to stop)" -ForegroundColor Green',
    'Write-Host ""',
    'Write-Host "  Time   Call          Band    Mode   Status" -ForegroundColor DarkGray',
    'Write-Host "  -----  ------------  ------  -----  ------" -ForegroundColor DarkGray',
    '',
    '$watcher = New-Object IO.FileSystemWatcher (Split-Path $LogFile), (Split-Path $LogFile -Leaf)',
    '$watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite',
    '$watcher.EnableRaisingEvents = $true',
    '',
    'while ($true) {',
    '    $ev = $watcher.WaitForChanged([IO.WatcherChangeTypes]::Changed, 4000)',
    '    if ($ev.TimedOut) { continue }',
    '    Start-Sleep -Milliseconds 250',
    '    try {',
    '        $content = [IO.File]::ReadAllText($LogFile)',
    '        Process-Log $content $sent',
    '    } catch {',
    '        Write-Host "  Read error: $($_.Exception.Message)" -ForegroundColor Red',
    '    }',
    '}',
  ];

  return L.join('\r\n');
}
