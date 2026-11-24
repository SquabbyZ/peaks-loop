# Local Claude Code adapter (not a peaks-managed hook entry): runs the three
# peaks PreToolUse gates a Bash call needs — code gate-step-08, gate enforce,
# code auto-compact — inside ONE process so the call opens one console window
# instead of three. Each gate still receives the original stdin payload and
# keeps its own exit code. Allow emits NOTHING on stdout (exit 0 is the
# contract); a block forwards that gate's stdout/stderr and exits 2, so the
# host sees at most one JSON document.
$ErrorActionPreference = 'Stop'
$enc = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = $enc } catch { }
$sr = New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $enc)
$payload = $sr.ReadToEnd()
$project = $env:CLAUDE_PROJECT_DIR
if (-not $project) { $project = '.' }
# `Get-Command peaks` prefers peaks.ps1 (an ExternalScript); Process.Start cannot
# run a .ps1 and fails with ERROR_BAD_EXE_FORMAT on every call. Pick a real
# executable instead: .exe first, then a .cmd through cmd.exe.
$peaksExe = $null
$peaksCmd = $null
foreach ($candidate in @(Get-Command peaks -All -ErrorAction SilentlyContinue)) {
  if ($candidate.CommandType -ne 'Application') { continue }
  if ($candidate.Source -match '\.exe$' -and -not $peaksExe) { $peaksExe = $candidate.Source }
  elseif ($candidate.Source -match '\.(cmd|bat)$' -and -not $peaksCmd) { $peaksCmd = $candidate.Source }
}

function Invoke-Gate([string[]]$argList) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $quoted = (($argList | ForEach-Object { '"' + ($_ -replace '"', '\"') + '"' }) -join ' ')
  if ($peaksExe) {
    $psi.FileName = $peaksExe
    $psi.Arguments = $quoted
  } else {
    $psi.FileName = $env:ComSpec
    $inner = '"' + $(if ($peaksCmd) { $peaksCmd } else { 'peaks' }) + '" ' + $quoted
    $psi.Arguments = '/d /s /c "' + $inner + '"'
  }
  $psi.RedirectStandardInput = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.UseShellExecute = $false
  $psi.StandardOutputEncoding = $enc
  $psi.StandardErrorEncoding = $enc
  $proc = [System.Diagnostics.Process]::Start($psi)
  $bytes = $enc.GetBytes($payload)
  # A gate that exits before reading stdin closes the pipe; that is a normal
  # outcome (its exit code and output still decide), not a hook failure.
  try {
    $proc.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
    $proc.StandardInput.BaseStream.Flush()
    $proc.StandardInput.Close()
  } catch {
    try { $proc.StandardInput.Close() } catch { }
  }
  $out = $proc.StandardOutput.ReadToEnd()
  $err = $proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  return @{ Code = $proc.ExitCode; Out = $out; Err = $err }
}

foreach ($argList in @(
    @('code', 'gate-step-08', '--project', $project),
    @('gate', 'enforce', '--project', $project, '--json'),
    @('code', 'auto-compact', '--project', '.')
  )) {
  $r = Invoke-Gate $argList
  if ($r.Code -eq 2) {
    [Console]::Out.Write($r.Out)
    [Console]::Error.Write($r.Err)
    exit 2
  }
}
exit 0
