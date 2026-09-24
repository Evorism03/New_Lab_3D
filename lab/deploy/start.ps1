<#
.SYNOPSIS
  Супервизор сервера заказов: запускает `node server.js`, следит за ним, перезапускает
  упавшее, пишет своё состояние в deploy\state.json. HTTPS не свой - им управляет Caddy
  у New_Lab_3d (сюда кладётся только site-блок при установке, см. setup.ps1).

.NOTES
  Обычно его запускает меню (lab.bat) как фоновый процесс - тогда он живёт после закрытия
  терминала. Можно запустить и вручную в окне: остановка по Ctrl+C.
#>
param()

. (Join-Path $PSScriptRoot "lib.ps1")
Set-Location $script:Root

New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null
$supervisorLog = Join-Path $script:LogDir "supervisor.log"

function Rotate-Log([string]$Path, [long]$MaxBytes = 5MB) {
    if ((Test-Path $Path) -and (Get-Item $Path).Length -gt $MaxBytes) {
        Move-Item -Path $Path -Destination "$Path.old" -Force -ErrorAction SilentlyContinue
    }
}

function Write-Log([string]$Message) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -Path $supervisorLog -Value $line -Encoding UTF8
    Write-Host $line
}

Rotate-Log $supervisorLog
Remove-Item $script:StopFlag -ErrorAction SilentlyContinue

if (Get-ServerState) { throw "Сервер уже запущен." }
if (-not (Test-Path $script:EnvFile)) { throw "Сначала выполните установку (lab.bat setup)." }

$config = Import-EnvFile $script:EnvFile
$appPort = [int]($config["PORT"])
if (-not $appPort) { throw "В .env нет PORT - повторите установку." }

$node = if ($config["DEPLOY_NODE"] -and (Test-Path $config["DEPLOY_NODE"])) { $config["DEPLOY_NODE"] } else { Find-Executable "node" }
if (-not $node) { throw "Node.js не найден." }

$owner = Get-PortOwner $appPort
if ($owner) { throw "Порт $appPort уже занят: $owner." }

$url = if ($config["DEPLOY_DOMAIN"]) { "https://$($config['DEPLOY_DOMAIN'])" } else { "http://127.0.0.1:$appPort" }

$state = [ordered]@{
    supervisorPid = $PID; supervisorStart = (Get-ProcStart $PID)
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    url = $url; port = $appPort; ready = $false
    appPid = $null; appStart = $null
}
Save-State $state

$appProcess = $null
$restarts = @()

function Get-RestartDelay {
    $now = Get-Date
    $script:restarts = @($restarts | Where-Object { ($now - $_).TotalSeconds -lt 120 }) + $now
    if ($restarts.Count -ge 5) { return 60 }
    return 2
}

function Start-App {
    foreach ($name in "app.log", "app-error.log") { Rotate-Log (Join-Path $script:LogDir $name) 2MB }
    # Windows PowerShell 5.1's Start-Process has no -Environment param; the child inherits
    # whatever is in $env: at the time it's spawned, so set PORT here first.
    $env:PORT = "$appPort"
    $script:appProcess = Start-Process -FilePath $node -ArgumentList @("server.js") `
        -WorkingDirectory $script:Root -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $script:LogDir "app.log") -RedirectStandardError (Join-Path $script:LogDir "app-error.log")
    $state.appPid = $script:appProcess.Id
    $state.appStart = Get-ProcStart $script:appProcess.Id
    $state.ready = $false
    Save-State $state

    for ($i = 0; $i -lt 60 -and -not $script:appProcess.HasExited; $i++) {
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$appPort/login.html" -UseBasicParsing -TimeoutSec 3 | Out-Null
            $state.ready = $true
            Save-State $state
            Write-Log "Сервер запущен ($($script:appProcess.Id))."
            return
        }
        catch { Start-Sleep -Seconds 1 }
    }
    Write-Log "Сервер не ответил за 60 секунд - подробности в deploy\logs\app-error.log"
}

try {
    Write-Log "Запуск: $url"
    Start-App

    while (-not (Test-Path $script:StopFlag)) {
        Start-Sleep -Seconds 1
        if ($appProcess.HasExited) {
            $delay = Get-RestartDelay
            Write-Log "Сервер остановился (код $($appProcess.ExitCode)). Перезапуск через $delay с."
            Start-Sleep -Seconds $delay
            if (Test-Path $script:StopFlag) { break }
            Start-App
        }
    }
    Write-Log "Получена команда остановки."
}
catch {
    Write-Log "Ошибка: $($_.Exception.Message)"
    throw
}
finally {
    if ($appProcess -and -not $appProcess.HasExited) { Stop-ProcessTree $appProcess.Id }
    Remove-Item $script:StopFlag -ErrorAction SilentlyContinue
    $saved = Read-State
    if ($saved -and $saved.supervisorPid -eq $PID) { Remove-Item $script:StateFile -ErrorAction SilentlyContinue }
    Write-Log "Сервер остановлен."
}
