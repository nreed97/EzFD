import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { badRequest, callsign } from '@/lib/validate';
import { BAND_EDGES } from '@/lib/catProtocol';

// Generates a single self-contained .bat file that embeds a PowerShell
// ADIF-watcher script. Double-clicking it on any Windows 10/11 machine
// will start relaying WSJT-X / JTDX QSOs to this EzFD server.
// No installation required -- PowerShell is built into Windows.

/** Where the script starts inside the .bat. The .bat finds it by searching for
 *  this text, so nothing a request supplies may ever contain it. */
const PS_MARKER = '#ezfd-ps-start#';

export async function GET(request: NextRequest) {
  const { searchParams, protocol, host } = request.nextUrl;

  // Every value here is written into a script the operator then runs, so each
  // is checked against the narrow shape it can legitimately have rather than
  // escaped. Escaping was not enough: the .bat locates its PowerShell by the
  // last marker in the file, so a value carrying the marker and a line break
  // replaced the start of the script with text of the link's author's choosing
  // -- a link to a club's own server that downloaded somebody else's commands.
  const rawCode = (searchParams.get('join_code') ?? searchParams.get('event_id') ?? '').trim().toUpperCase();
  if (!rawCode) return badRequest('join_code required');
  if (!/^[A-Z0-9]{4,8}$/.test(rawCode)) return badRequest('join_code is not a join code');

  const rawOperator = searchParams.get('operator') ?? '';
  const operator = rawOperator ? callsign(rawOperator) : '';
  if (operator === null) return badRequest('operator is not a callsign');

  const rawStation = searchParams.get('station') ?? '1';
  if (!/^\d{1,3}$/.test(rawStation)) return badRequest('station is not a station number');
  const station = Math.max(1, parseInt(rawStation, 10));

  // The server the relay posts to is the one the file was downloaded from. A
  // different api_url would let a link send a station's contacts elsewhere,
  // so one is accepted only when it names this same origin (the setup panel
  // sends window.location.origin, which is exactly that).
  const origin = `${protocol}//${host}`;
  const rawApi = searchParams.get('api_url');
  let apiUrl = origin;
  if (rawApi) {
    let parsed: URL | null = null;
    try { parsed = new URL(rawApi); } catch { /* not a URL */ }
    // Behind a proxy the address the browser used arrives in the Host or
    // X-Forwarded-Host header. Those are set by whoever makes the request,
    // not by whoever wrote the link, so matching them is still "this server".
    const here = new Set(
      [host, request.headers.get('host'), request.headers.get('x-forwarded-host')]
        .filter((h): h is string => !!h).map(h => h.toLowerCase()),
    );
    if (!parsed || !/^https?:$/.test(parsed.protocol) || !here.has(parsed.host.toLowerCase())) {
      return badRequest('api_url must be this server');
    }
    apiUrl = `${parsed.protocol}//${parsed.host}`;
  }
  // Belt and braces: the host header is the one value above not matched
  // against a fixed alphabet.
  if (!/^https?:\/\/[A-Za-z0-9.\-:\[\]]+$/.test(apiUrl)) return badRequest('Unusable server address');

  const content = buildBatFile(rawCode, apiUrl, operator, station);
  // The marker appears exactly twice in a sound file: once in the command
  // that searches for it and once where the script starts.
  if (content.split(PS_MARKER).length - 1 !== 2) return badRequest('Unusable request');

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
    '  "$c=[IO.File]::ReadAllText($env:SELF,[Text.Encoding]::UTF8);$i=$c.LastIndexOf(\'#ezfd-ps-start#\');[IO.File]::WriteAllText($env:TF,$c.Substring($i+15),[Text.Encoding]::UTF8)"',
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
    PS_MARKER,
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
    '        if (@(' + BAND_EDGES.map(e => Q + e[2] + Q).join(',') + ') -contains $b) { return $b }',
    '    }',
    '    if ($freq) {',
    '        $n = 0.0',
    '        if ([double]::TryParse([string]$freq, [ref]$n)) {',
    '            $k = $n * 1000',
    // Written out from the one table in lib/catProtocol.ts, so this script
    // cannot fall behind it. It had: the WARC bands and 60m were missing, and
    // a special event's contacts on them were skipped without a word.
    ...BAND_EDGES.map(e =>
      '            if ($k -ge ' + (e[0] / 1000) + ' -and $k -le ' + (e[1] / 1000) + ') { return ' + Q + e[2] + Q + ' }'),
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
