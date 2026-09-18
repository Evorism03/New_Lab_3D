<#
.SYNOPSIS
  Супервизор сервера: запускает сайт (Next.js) и HTTPS-прокси (Caddy), следит за ними,
  перезапускает упавшее и пишет своё состояние в deploy\state.json.

.NOTES
  Обычно его запускает меню (server.bat) как фоновый процесс - тогда он живёт после
  закрытия терминала. Можно запустить и вручную в окне: остановка по Ctrl+C.
    -NoCaddy  обычный HTTP прямо на IP сервера, без HTTPS (только для проверки)
    -Rebuild  пересобрать сайт перед запуском
#>
param(
    [switch]$NoCaddy,
    [switch]$Rebuild
)

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
if (-not (Test-Path $script:EnvFile)) { throw "Сначала выполните установку (файл .env.production не найден)." }

$config = Import-EnvFile $script:EnvFile
$domain = $config["DEPLOY_DOMAIN"]
$ip = $config["DEPLOY_IP"]
$appPort = [int]$config["APP_PORT"]
if (-not $ip) { throw "В .env.production нет DEPLOY_IP - повторите установку." }

# IP компьютера мог смениться (DHCP, другой адаптер) - тогда идём за текущим.
$currentIps = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ForEach-Object { $_.IPAddress })
if ($currentIps -notcontains $ip) {
    $newIp = Get-LocalIp
    Write-Log "Сохранённый IP $ip больше не найден на этом компьютере, использую $newIp."
    $ip = $newIp
}

$node = if ($config["DEPLOY_NODE"] -and (Test-Path $config["DEPLOY_NODE"])) { $config["DEPLOY_NODE"] } else { Find-Executable "node" }
if (-not $node) { throw "Node.js не найден." }
$nextBin = Join-Path $script:Root "node_modules\next\dist\bin\next"

if ($Rebuild -or -not (Test-Path (Join-Path $script:Root ".next\BUILD_ID"))) {
    Write-Log "Сборка сайта..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Сборка не удалась." }
}

# Next слушает loopback за Caddy - либо прямо IP сервера, если Caddy не используется.
$appHost = if ($NoCaddy) { $ip } else { "127.0.0.1" }
$publicPorts = if ($NoCaddy) { @() } else { @(80, 443) }
foreach ($port in (@($appPort) + $publicPorts)) {
    $owner = Get-PortOwner $port
    if ($owner) { throw "Порт $port уже занят: $owner. Освободите его (порт 80 часто занимает IIS)." }
}

$caddy = $null
if (-not $NoCaddy) {
    $caddy = if ($config["DEPLOY_CADDY"] -and (Test-Path $config["DEPLOY_CADDY"])) { $config["DEPLOY_CADDY"] } else { Find-Caddy }
    if (-not $caddy) { throw "Caddy не установлен. Выполните: winget install CaddyServer.Caddy" }
    [IO.File]::WriteAllText($script:CaddyFile, (New-CaddyfileText $domain $ip $appPort), (New-Object Text.UTF8Encoding($false)))
    & $caddy validate --config $script:CaddyFile --adapter caddyfile 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Сгенерированный Caddyfile неверен: $script:CaddyFile" }
}

$mode = if ($NoCaddy) { "http" } elseif ($domain) { "https-domain" } else { "https-ip" }
$url = if ($NoCaddy) { "http://${ip}:$appPort" } elseif ($domain) { "https://$domain" } else { "https://$ip" }

$state = [ordered]@{
    supervisorPid = $PID; supervisorStart = (Get-ProcStart $PID)
    startedAt = (Get-Date).ToUniversalTime().ToString("o")
    mode = $mode; url = $url; ip = $ip; port = $appPort; ready = $false
    nextPid = $null; nextStart = $null; caddyPid = $null; caddyStart = $null
}
Save-State $state

$nextProcess = $null
$caddyProcess = $null
$restarts = @{ next = @(); caddy = @() }

function Start-Site {
    foreach ($name in "next.log", "next-error.log") { Rotate-Log (Join-Path $script:LogDir $name) 2MB }
    $script:nextProcess = Start-Process -FilePath $node -ArgumentList @($nextBin, "start", "-H", $appHost, "-p", "$appPort") `
        -WorkingDirectory $script:Root -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $script:LogDir "next.log") -RedirectStandardError (Join-Path $script:LogDir "next-error.log")
    $state.nextPid = $script:nextProcess.Id
    $state.nextStart = Get-ProcStart $script:nextProcess.Id
    $state.ready = $false
    Save-State $state

    $probeHost = if ($NoCaddy) { $ip } else { "127.0.0.1" }
    for ($i = 0; $i -lt 60 -and -not $script:nextProcess.HasExited; $i++) {
        try {
            Invoke-WebRequest -Uri "http://${probeHost}:$appPort/" -UseBasicParsing -TimeoutSec 3 | Out-Null
            $state.ready = $true
            Save-State $state
            Write-Log "Сайт запущен ($($script:nextProcess.Id))."
            return
        }
        catch { Start-Sleep -Seconds 1 }
    }
    Write-Log "Сайт не ответил за 60 секунд - подробности в deploy\logs\next-error.log"
}

function Start-Proxy {
    Rotate-Log (Join-Path $script:LogDir "caddy-error.log") 2MB
    $script:caddyProcess = Start-Process -FilePath $caddy -ArgumentList @("run", "--config", $script:CaddyFile, "--adapter", "caddyfile") `
        -WorkingDirectory $PSScriptRoot -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $script:LogDir "caddy.log") -RedirectStandardError (Join-Path $script:LogDir "caddy-error.log")
    $state.caddyPid = $script:caddyProcess.Id
    $state.caddyStart = Get-ProcStart $script:caddyProcess.Id
    Save-State $state
    Write-Log "Caddy запущен ($($script:caddyProcess.Id)), адрес: $url"
}

# Не даём упавшему процессу перезапускаться бесконечно и без пауз.
function Get-RestartDelay([string]$Key) {
    $now = Get-Date
    $restarts[$Key] = @($restarts[$Key] | Where-Object { ($now - $_).TotalSeconds -lt 120 }) + $now
    if ($restarts[$Key].Count -ge 5) { return 60 }
    return 2
}

try {
    Write-Log "Запуск: $url (режим $mode)"
    Start-Site
    if ($caddy) { Start-Proxy }

    while (-not (Test-Path $script:StopFlag)) {
        Start-Sleep -Seconds 1
        if ($nextProcess.HasExited) {
            $delay = Get-RestartDelay "next"
            Write-Log "Сайт остановился (код $($nextProcess.ExitCode)). Перезапуск через $delay с."
            Start-Sleep -Seconds $delay
            if (Test-Path $script:StopFlag) { break }
            Start-Site
        }
        if ($caddy -and $caddyProcess.HasExited) {
            $delay = Get-RestartDelay "caddy"
            Write-Log "Caddy остановился (код $($caddyProcess.ExitCode)). Перезапуск через $delay с."
            Start-Sleep -Seconds $delay
            if (Test-Path $script:StopFlag) { break }
            Start-Proxy
        }
    }
    Write-Log "Получена команда остановки."
}
catch {
    Write-Log "Ошибка: $($_.Exception.Message)"
    throw
}
finally {
    foreach ($process in @($caddyProcess, $nextProcess)) {
        if ($process -and -not $process.HasExited) { Stop-ProcessTree $process.Id }
    }
    Remove-Item $script:StopFlag -ErrorAction SilentlyContinue
    $saved = Read-State
    if ($saved -and $saved.supervisorPid -eq $PID) { Remove-Item $script:StateFile -ErrorAction SilentlyContinue }
    Write-Log "Сервер остановлен."
}
