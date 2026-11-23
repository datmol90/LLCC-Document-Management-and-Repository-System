$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host 'Starting LLCC Document Management System...' -ForegroundColor Cyan
Write-Host 'Backend:  http://localhost:5000' -ForegroundColor Gray
Write-Host 'Frontend: http://localhost:5173' -ForegroundColor Gray

$backend = Start-Process -FilePath 'npm' -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'backend') -PassThru
$frontend = Start-Process -FilePath 'npm' -ArgumentList 'run','dev' -WorkingDirectory (Join-Path $root 'frontend') -PassThru

try {
  Write-Host 'Press Ctrl+C to stop both servers.' -ForegroundColor Yellow
  Wait-Process -Id $backend.Id, $frontend.Id
} finally {
  Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
}
