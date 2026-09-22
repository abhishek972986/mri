# Start the API and the dashboard together.
#   .\run.ps1          both
#   .\run.ps1 api      backend only
#   .\run.ps1 web      frontend only

param([string]$Target = "both")

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "No virtualenv found. Creating one..." -ForegroundColor Yellow
    python -m venv (Join-Path $root ".venv")
    & $python -m pip install --upgrade pip
    & $python -m pip install -r (Join-Path $root "requirements.txt")
}

function Start-Api {
    Write-Host "API      http://127.0.0.1:8000/docs" -ForegroundColor Cyan
    & $python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000 --app-dir (Join-Path $root "backend")
}

function Start-Web {
    Push-Location (Join-Path $root "frontend")
    if (-not (Test-Path "node_modules")) { npm install }
    Write-Host "Dashboard  http://127.0.0.1:5173" -ForegroundColor Cyan
    npm run dev
    Pop-Location
}

switch ($Target) {
    "api" { Start-Api }
    "web" { Start-Web }
    default {
        Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$PSCommandPath' api"
        Start-Sleep -Seconds 2
        Start-Web
    }
}
