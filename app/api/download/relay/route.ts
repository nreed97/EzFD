import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Generates a single self-contained .bat file that embeds a PowerShell
// ADIF-watcher script. Double-clicking it on any Windows 10/11 machine
// will start relaying WSJT-X / JTDX QSOs to this EzFD server.
// No installation required — PowerShell is built into Windows.

export async function GET(request: NextRequest) {
  const { searchParams, protocol, host } = request.nextUrl;

  const eventId  = searchParams.get('event_id')  ?? '';
  const operator = searchParams.get('operator')   ?? '';
  const station  = searchParams.get('station')    ?? '1';
  // Client passes its own origin so the script targets the right server
  // even behind a reverse proxy. Fall back to the request host if absent.
  const apiUrl   = searchParams.get('api_url')    ?? `${protocol}//${host}`;

  if (!eventId) {
    return NextResponse.json({ error: 'event_id required' }, { status: 400 });
  }

  const content = buildBatFile(eventId, apiUrl, operator, parseInt(station, 10) || 1);

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="ezfd-wsjt-relay.bat"',
      'Cache-Control': 'no-store',
    },
  });
}

// ──────────────────────────────────────────────────────────
// .bat wrapper — reads its own file, extracts the PS section
// after the #ezfd-ps-start# marker, and executes it.
// The marker is exactly 15 chars so the Substring offset is right.
// ──────────────────────────────────────────────────────────
function buildBatFile(eventId: string, apiUrl: string, operator: string, station: number): string {
  const ps = buildPsScript(eventId, apiUrl, operator, station);

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
    '  "$c=[IO.File]::ReadAllText($env:SELF);$i=$c.IndexOf(\'#ezfd-ps-start#\');[IO.File]::WriteAllText($env:TF,$c.Substring($i+15))"',
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

// ──────────────────────────────────────────────────────────
// PowerShell 5.1-compatible ADIF file watcher.
// Watches the WSJT-X / JTDX log file for new entries and
// POSTs each new QSO to EzFD via /api/qso.
// ──────────────────────────────────────────────────────────
function buildPsScript(eventId: string, apiUrl: string, operator: string, station: number): string {
  // Escape single quotes in config values for PS string literals
  const safeId  = eventId.replace(/'/g, "''");
  const safeUrl = apiUrl.replace(/'/g, "''");
  const safeOp  = operator.replace(/'/g, "''");

  return `
# ── EzFD WSJT-X Relay ── auto-generated, do not edit ──────
$EventId      = '${safeId}'
$ApiUrl       = '${safeUrl}'
$OperatorCall = '${safeOp}'
$StationNum   = ${station}

# Search order: WSJT-X local, WSJT-X roaming, JTDX local, JTDX roaming
$LogCandidates = @(
    "$env:LOCALAPPDATA\\WSJT-X\\wsjtx_log.adi"
    "$env:APPDATA\\WSJT-X\\wsjtx_log.adi"
    "$env:LOCALAPPDATA\\JTDX\\jtdx_log.adi"
    "$env:APPDATA\\JTDX\\jtdx_log.adi"
)

# ── helpers ─────────────────────────────────────────────────

function Get-AdifFields($record) {
    $fields = @{}
    $ms = [regex]::Matches($record, '<([A-Z0-9_]+):(\d+)(?::[^>]+)?>', 'IgnoreCase')
    foreach ($m in $ms) {
        $name  = $m.Groups[1].Value.ToUpper()
        $len   = [int]$m.Groups[2].Value
        $start = $m.Index + $m.Length
        if (($start + $len) -le $record.Length) {
            $fields[$name] = $record.Substring($start, $len)
        }
    }
    return $fields
}

function Get-Band($band, $freq) {
    if ($band) {
        $b = ([string]$band).ToLower().Trim()
        if (@('160m','80m','40m','20m','15m','10m','6m','2m','1.25m','70cm') -contains $b) { return $b }
    }
    if ($freq) {
        $n = 0.0
        if ([double]::TryParse([string]$freq, [ref]$n)) {
            $k = $n * 1000
            if ($k -ge 1800  -and $k -lt 2000)    { return '160m' }
            if ($k -ge 3500  -and $k -lt 4000)    { return '80m'  }
            if ($k -ge 7000  -and $k -lt 7300)    { return '40m'  }
            if ($k -ge 14000 -and $k -lt 14350)   { return '20m'  }
            if ($k -ge 21000 -and $k -lt 21450)   { return '15m'  }
            if ($k -ge 28000 -and $k -lt 29700)   { return '10m'  }
            if ($k -ge 50000 -and $k -lt 54000)   { return '6m'   }
            if ($k -ge 144000 -and $k -lt 148000) { return '2m'   }
        }
    }
    return $null
}

function Get-Mode($mode) {
    $m = ([string]$mode).ToUpper().Trim()
    if ($m -eq 'CW') { return 'CW' }
    if (@('SSB','USB','LSB','FM','AM') -contains $m) { return 'PH' }
    return 'DIG'
}

function Build-SentSet($content) {
    $set = @{}
    foreach ($rec in ($content -split '(?i)<EOR>')) {
        $f    = Get-AdifFields $rec
        $call = ([string]$f['CALL']).Trim().ToUpper()
        if (-not $call) { continue }
        $band = Get-Band ([string]$f['BAND']) ([string]$f['FREQ'])
        if (-not $band) { continue }
        $mode = Get-Mode ([string]$f['MODE'])
        $set["$call|$band|$mode"] = $true
    }
    return $set
}

function Send-Qso($call, $band, $mode, $rcvdClass, $rcvdSection) {
    $body = @{
        event_id       = $EventId
        callsign       = $call
        band           = $band
        mode           = $mode
        rcvd_class     = $rcvdClass
        rcvd_section   = $rcvdSection
        operator_call  = $OperatorCall
        station_number = $StationNum
    } | ConvertTo-Json -Compress

    try {
        $r = Invoke-RestMethod \`
            -Uri "$ApiUrl/api/qso" \`
            -Method Post \`
            -Body $body \`
            -ContentType 'application/json' \`
            -TimeoutSec 10 \`
            -ErrorAction Stop

        if ($r.is_dupe) {
            Write-Host "  $(Get-Date -F 'HH:mm')  $($call.PadRight(12)) $($band.PadRight(6)) $mode  already in log" -ForegroundColor Yellow
        } else {
            Write-Host "  $(Get-Date -F 'HH:mm')  $($call.PadRight(12)) $($band.PadRight(6)) $mode  logged!" -ForegroundColor Green
        }
    } catch {
        Write-Host "  $(Get-Date -F 'HH:mm')  $($call.PadRight(12)) $($band.PadRight(6)) $mode  ERROR: $($_.Exception.Message)" -ForegroundColor Red
    }
}

function Process-Log($content, $sentSet) {
    foreach ($rec in ($content -split '(?i)<EOR>')) {
        $f    = Get-AdifFields $rec
        $call = ([string]$f['CALL']).Trim().ToUpper()
        if (-not $call) { continue }

        $band = Get-Band ([string]$f['BAND']) ([string]$f['FREQ'])
        if (-not $band) { continue }

        $mode = Get-Mode ([string]$f['MODE'])
        $key  = "$call|$band|$mode"
        if ($sentSet.ContainsKey($key)) { continue }
        $sentSet[$key] = $true

        # Field Day exchange: CLASS field + ARRL_SECT, or SRX_STRING "2A EPA"
        $rcvdClass   = ([string]$f['CLASS']).Trim().ToUpper()
        $rcvdSection = ([string]$f['ARRL_SECT']).Trim().ToUpper()
        if (-not $rcvdSection) { $rcvdSection = ([string]$f['STATE']).Trim().ToUpper() }

        if ((-not $rcvdClass -or -not $rcvdSection) -and $f['SRX_STRING']) {
            $parts = ([string]$f['SRX_STRING']).Trim() -split '\\s+'
            if ($parts.Count -ge 2) {
                if (-not $rcvdClass)   { $rcvdClass   = $parts[0].ToUpper() }
                if (-not $rcvdSection) { $rcvdSection = $parts[1].ToUpper() }
            }
        }

        Send-Qso $call $band $mode $rcvdClass $rcvdSection
    }
}

# ── main ────────────────────────────────────────────────────

Write-Host ""
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "    EzFD  WSJT-X / JTDX  Relay" -ForegroundColor Cyan
Write-Host "  ================================================" -ForegroundColor Cyan
Write-Host "  Server:   $ApiUrl" -ForegroundColor DarkGray
if ($OperatorCall) {
    Write-Host "  Operator: $OperatorCall" -ForegroundColor DarkGray
}
Write-Host ""

# Find log file
$LogFile = $null
foreach ($p in $LogCandidates) {
    if (Test-Path $p) { $LogFile = $p; break }
}

if ($LogFile) {
    Write-Host "  Log file: $LogFile" -ForegroundColor DarkGray
    Write-Host ""
} else {
    Write-Host "  Waiting for WSJT-X to create its log file..." -ForegroundColor Yellow
    Write-Host "  (Start WSJT-X and log at least one QSO)" -ForegroundColor DarkGray
    Write-Host ""
    $LogFile = $LogCandidates[0]
    $dir = Split-Path $LogFile
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    while (-not (Test-Path $LogFile)) { Start-Sleep -Seconds 2 }
    Write-Host "  Found: $LogFile" -ForegroundColor Green
    Write-Host ""
}

# Snapshot existing QSOs so we don't re-send them on restart
$sent = @{}
try {
    $existing = [IO.File]::ReadAllText($LogFile)
    $sent = Build-SentSet $existing
    if ($sent.Count -gt 0) {
        Write-Host "  Skipping $($sent.Count) QSO(s) already in the log." -ForegroundColor DarkGray
        Write-Host ""
    }
} catch { }

Write-Host "  Watching for new QSOs  (Ctrl-C or close window to stop)" -ForegroundColor Green
Write-Host ""
Write-Host "  Time   Call          Band    Mode   Status" -ForegroundColor DarkGray
Write-Host "  -----  ------------  ------  -----  ------" -ForegroundColor DarkGray

# FileSystemWatcher fires immediately when WSJT-X writes a new QSO
$watcher = New-Object IO.FileSystemWatcher (Split-Path $LogFile), (Split-Path $LogFile -Leaf)
$watcher.NotifyFilter = [IO.NotifyFilters]::LastWrite
$watcher.EnableRaisingEvents = $true

while ($true) {
    $ev = $watcher.WaitForChanged([IO.WatcherChangeTypes]::Changed, 4000)
    if ($ev.TimedOut) { continue }
    Start-Sleep -Milliseconds 250   # let WSJT-X finish writing
    try {
        $content = [IO.File]::ReadAllText($LogFile)
        Process-Log $content $sent
    } catch {
        Write-Host "  Read error: $($_.Exception.Message)" -ForegroundColor Red
    }
}
`.trimStart();
}
