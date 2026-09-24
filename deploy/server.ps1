<#
.SYNOPSIS
  Управление сайтом на Windows-сервере: меню и команды. Запускается через server.bat.

.EXAMPLE
  server.bat                # меню
  server.bat start          # запустить в фоне
  server.bat stop           # остановить
  server.bat restart
  server.bat status
  server.bat logs           # живые логи (Q - выход)
  server.bat update         # обновить и пересобрать
  server.bat setup          # установка / смена домена
  server.bat autostart      # включить/выключить запуск вместе с Windows
  server.bat cleanup        # очистка лишних файлов
  server.bat uninstall
#>
param(
    [Parameter(Position = 0)][string]$Command = "menu",
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest = @(),
    [switch]$Elevated,
    [switch]$NoElevate,
    [switch]$Yes,
    [switch]$Force,
    [switch]$RemoveModules
)

. (Join-Path $PSScriptRoot "lib.ps1")
. (Join-Path $PSScriptRoot "ui.ps1")
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = New-Object Text.UTF8Encoding($false)
$Host.UI.RawUI.WindowTitle = "Лаборатория 3Д - сервер"
Set-Location $script:Root

# Брандмауэр и задачи планировщика требуют прав администратора (-NoElevate пропускает запрос).
if (-not $NoElevate -and -not (Test-Admin)) {
    try {
        $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath), $Command) + $Rest + "-Elevated"
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList
    }
    catch { Write-Bad "Нужны права администратора, а запрос UAC был отклонён." }
    return
}

# Случайный клик мышью включает в консоли режим выделения («Выбрать» в заголовке), и вывод замирает.
# В интерактивном меню отключаем QuickEdit, чтобы окно нельзя было "заморозить" мышью.
if (-not [Console]::IsInputRedirected -and -not [Console]::IsOutputRedirected) {
    try {
        Add-Type -Namespace Native -Name Con -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int handle);
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr handle, out uint mode);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr handle, uint mode);
'@
        $consoleHandle = [Native.Con]::GetStdHandle(-10)
        $consoleMode = [uint32]0
        if ([Native.Con]::GetConsoleMode($consoleHandle, [ref]$consoleMode)) {
            [void][Native.Con]::SetConsoleMode($consoleHandle, [uint32](($consoleMode -band (-bnot 0x40)) -bor 0x80))
        }
    }
    catch { }
}

$script:StartScript = Join-Path $PSScriptRoot "start.ps1"
$script:AssumeYes = [bool]$Yes
$script:HadError = $false

# lab (заказы/сборка/отправка) живёт в подпапке lab/ этого же репозитория и управляется
# собственными deploy-скриптами - здесь их просто перевызываем, ничего не дублируя.
$script:LabRoot = Join-Path $script:Root "lab"
$script:LabServerScript = Join-Path $script:LabRoot "deploy\server.ps1"
function Test-LabPresent { Test-Path $script:LabServerScript }
function Invoke-Lab([string]$Cmd) {
    if (Test-LabPresent) { & $script:LabServerScript $Cmd -Yes:$script:AssumeYes -NoElevate }
}

function Format-Uptime($StartedAt) {
    $span = (Get-Date).ToUniversalTime() - (ConvertTo-Utc $StartedAt)
    if ($span.TotalDays -ge 1) { return ("{0} д {1} ч" -f [int]$span.TotalDays, $span.Hours) }
    if ($span.TotalHours -ge 1) { return ("{0} ч {1} мин" -f [int]$span.TotalHours, $span.Minutes) }
    return ("{0} мин {1} с" -f $span.Minutes, $span.Seconds)
}

function Show-Status {
    $installed = Test-Path $script:EnvFile
    $config = Read-EnvFile $script:EnvFile
    $state = Get-ServerState

    if (-not $installed) {
        Write-Field "Статус" "○ Не установлен" "Yellow"
        Write-Field "Что делать" "выберите [6] Установка" "DarkGray"
        return
    }

    if ($state -and $state.ready) {
        Write-Host ("  {0,-12}" -f "Статус") -NoNewline -ForegroundColor DarkGray
        Write-Host "● Работает" -NoNewline -ForegroundColor Green
        Write-Host ("   аптайм {0}" -f (Format-Uptime $state.startedAt)) -ForegroundColor DarkGray
        Write-Field "Адрес" $state.url "Cyan"
        $procs = "сайт PID {0}" -f $state.nextPid
        if ($state.caddyPid) { $procs += " · Caddy PID {0}" -f $state.caddyPid }
        Write-Field "Процессы" $procs "Gray"
    }
    elseif ($state) {
        Write-Field "Статус" "● Запускается или перезапускается..." "Yellow"
        Write-Field "Адрес" $state.url "Cyan"
    }
    else {
        Write-Field "Статус" "○ Остановлен" "Red"
        $target = if ($config["DEPLOY_DOMAIN"]) { "https://" + $config["DEPLOY_DOMAIN"] } else { "https://" + $config["DEPLOY_IP"] }
        Write-Field "Адрес" $target "DarkGray"
    }

    $task = Get-AutostartTask
    Write-Field "Автозапуск" $(if ($task) { "включён (стартует вместе с Windows)" } else { "выключен" }) $(if ($task) { "Green" } else { "DarkGray" })
    $uploads = Format-Size (Get-FolderSize (Join-Path $script:Root "uploads"))
    $logs = Format-Size (Get-FolderSize $script:LogDir)
    Write-Field "Диск" "загрузки $uploads · логи $logs" "Gray"
}

# lab печатает свой собственный статус (та же Show-Status/Write-Field из его server.ps1) -
# просто зовём как отдельный процесс и не парсим вывод.
function Show-LabStatus {
    if (-not (Test-LabPresent)) { return }
    Write-Host ""
    Write-Rule
    Write-Host "  Заказы (lab)" -ForegroundColor Cyan
    & $script:LabServerScript status -NoElevate
}

function Show-Screen {
    Clear-Host
    Write-Host ""
    Show-Header
    Write-Host ""
    Show-Status
    Show-LabStatus
    Write-Host ""
    Write-Rule
}

function Test-Installed {
    if (Test-Path $script:EnvFile) { return $true }
    Write-Bad "Сервер ещё не установлен. Выберите «Установка» в меню (server.bat setup)."
    return $false
}

function Invoke-Start {
    if (-not (Test-Installed)) { return }
    if (Get-ServerState) { Write-Info "Сервер уже запущен."; Invoke-Lab start; return }

    $config = Import-EnvFile $script:EnvFile
    $caddy = if ($config["DEPLOY_CADDY"] -and (Test-Path $config["DEPLOY_CADDY"])) { $config["DEPLOY_CADDY"] } else { Find-Caddy }
    if (-not $caddy) { Write-Bad "Caddy не установлен: winget install CaddyServer.Caddy"; return }

    foreach ($port in @([int]$config["APP_PORT"], 80, 443)) {
        $owner = Get-PortOwner $port
        if ($owner) { Write-Bad "Порт $port занят: $owner. Освободите его (порт 80 часто занимает IIS)."; return }
    }

    if (-not (Test-Path (Join-Path $script:Root ".next\BUILD_ID"))) {
        Write-Step "Первая сборка сайта (до пары минут)"
        & npm run build
        if ($LASTEXITCODE -ne 0) { Write-Bad "Сборка не удалась."; return }
    }

    $procId = Start-Detached ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script:StartScript) $script:Root
    $ok = Show-Spinner { $s = Read-State; ($s -and $s.ready) -or -not (Test-ProcAlive $procId $null) } "Запускаю сервер" 120
    $state = Get-ServerState
    if ($ok -and $state -and $state.ready) {
        Write-Good "Сервер запущен и работает в фоне. Терминал можно закрыть."
        Write-Field "Адрес" $state.url "Cyan"
        if ($state.mode -eq "https-ip") { Write-Dim "Сертификат самоподписанный: браузер предупредит один раз. С доменом сертификат будет доверенным." }
    }
    else {
        Write-Bad "Сервер не запустился. Последние события:"
        $log = Join-Path $script:LogDir "supervisor.log"
        if (Test-Path $log) { Get-Content -Path $log -Tail 8 -Encoding UTF8 | ForEach-Object { Write-Dim $_ } }
    }
    Invoke-Lab start
}

function Invoke-Stop {
    $wasRunning = [bool](Read-State)
    if (-not $wasRunning) { Write-Info "Сервер и так остановлен."; Invoke-Lab stop; return }
    Write-Info "Останавливаю сервер..."
    Stop-Server
    Write-Good "Сервер остановлен."
    Invoke-Lab stop
}

function Invoke-Restart {
    if (-not (Test-Installed)) { return }
    Invoke-Stop
    Invoke-Start
}

function Invoke-Logs {
    while ($true) {
        Show-Screen
        Write-Info "Какой лог смотреть? (живой вывод, выход - Q)"
        Write-Host ""
        Write-MenuItem "1" "Сайт" "вывод приложения"
        Write-MenuItem "2" "Ошибки сайта" "next-error.log"
        Write-MenuItem "3" "HTTPS (Caddy)" "сертификаты, запросы"
        Write-MenuItem "4" "События сервера" "запуски, падения, перезапуски"
        if (Test-LabPresent) {
            Write-MenuItem "5" "Заказы (lab)" "вывод приложения"
            Write-MenuItem "6" "Заказы: ошибки" "app-error.log"
        }
        Write-MenuItem "0" "Назад"
        Write-Host ""
        Write-Host "  Выбор: " -NoNewline -ForegroundColor Gray
        switch (Read-MenuKey) {
            "1" { Show-LogTail (Join-Path $script:LogDir "next.log") "Сайт" }
            "2" { Show-LogTail (Join-Path $script:LogDir "next-error.log") "Ошибки сайта" }
            "3" { Show-LogTail (Join-Path $script:LogDir "caddy-error.log") "HTTPS (Caddy)" }
            "4" { Show-LogTail (Join-Path $script:LogDir "supervisor.log") "События сервера" }
            "5" { if (Test-LabPresent) { Show-LogTail (Join-Path $script:LabRoot "deploy\logs\app.log") "Заказы (lab)" } }
            "6" { if (Test-LabPresent) { Show-LogTail (Join-Path $script:LabRoot "deploy\logs\app-error.log") "Заказы: ошибки" } }
            default { return }
        }
    }
}

function Update-FromGit {
    if (-not (Test-Path (Join-Path $script:Root ".git"))) { Write-Info "Папка не подключена к git - код не обновляется автоматически."; return $true }
    if (-not (Find-Executable "git")) { Write-Bad "git не установлен: winget install Git.Git"; return $false }

    Write-Step "Получение обновлений (git)"
    $info = Get-GitInfo
    if ($info.error) { Write-Bad "Не удалось связаться с репозиторием: $($info.error)"; return $false }
    if (-not $info.upstream) { Write-Bad "Ветка не привязана к удалённому репозиторию."; return $false }
    if ($info.behind -eq 0) {
        # Репозиторий "актуален", но файлы на диске могут быть старыми (например, после git reset --mixed).
        if ($Force -and $info.dirty -gt 0) {
            Write-Info "Файлов, отличающихся от репозитория: $($info.dirty). Привожу их к версии $($info.head)."
            $out = Invoke-Git reset --hard "@{u}"
            $out | ForEach-Object { Write-Dim $_ }
            if ($script:GitExit -ne 0) { Write-Bad "Не удалось выполнить git reset."; return $false }
            Write-Ok "Файлы синхронизированы."
            return $true
        }
        Write-Ok "Код уже актуален ($($info.head))."
        return $true
    }

    Write-Info ("Новых коммитов: {0}" -f $info.behind)
    foreach ($line in $info.commits) { Write-Dim $line }
    $out = Invoke-Git pull --ff-only
    $out | ForEach-Object { Write-Dim $_ }
    if ($script:GitExit -eq 0) { Write-Ok "Код обновлён."; return $true }

    if (-not $Force) { Write-Bad "git pull не удался: локальные изменения мешают обновлению."; return $false }
    Write-Info "Принудительное обновление: локальные изменения отбрасываются."
    $out = Invoke-Git reset --hard "@{u}"
    $out | ForEach-Object { Write-Dim $_ }
    if ($script:GitExit -ne 0) { Write-Bad "Не удалось выполнить git reset."; return $false }
    Write-Ok "Код обновлён."
    return $true
}

function Invoke-Update {
    # Без установленного сервера (например, на компьютере разработчика) обновляется только код.
    $installed = Test-Path $script:EnvFile
    $wasRunning = $installed -and [bool](Get-ServerState)
    if ($wasRunning) { Invoke-Stop }
    if ($installed) { Import-EnvFile $script:EnvFile | Out-Null }

    if ((Test-Path (Join-Path $script:Root ".git")) -and ($script:AssumeYes -or (Read-Confirm "Скачать свежий код (git pull)?"))) {
        if (-not (Update-FromGit)) { if ($wasRunning) { Invoke-Start }; return }
    }

    if (Test-LabPresent) {
        Write-Step "Зависимости «Заказы» (lab)"
        Push-Location $script:LabRoot
        try { & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Write-Bad "npm install в lab не удался." } }
        finally { Pop-Location }
    }

    if (-not $installed) {
        Write-Good "Код обновлён. Сервер здесь не установлен, поэтому зависимости, сборка и перезапуск пропущены."
        return
    }
    Write-Step "Зависимости";  & npm install --no-audit --no-fund;  if ($LASTEXITCODE -ne 0) { Write-Bad "npm install не удался."; return }
    Write-Step "Клиент базы";  & npx prisma generate;               if ($LASTEXITCODE -ne 0) { Write-Bad "prisma generate не удался."; return }
    Write-Step "Схема базы";   & npx prisma db push;                if ($LASTEXITCODE -ne 0) { Write-Bad "prisma db push не удался."; return }
    Write-Step "Сборка сайта"; & npm run build;                     if ($LASTEXITCODE -ne 0) { Write-Bad "Сборка не удалась."; return }
    Write-Good "Обновление завершено."
    if ($wasRunning) { Invoke-Start }
    else { Write-Info "Сервер был остановлен - запустите его пунктом [1]." }
}

# Machine-readable commands used by the desktop app.
function Invoke-GitCheck { Get-GitInfo | ConvertTo-Json -Compress -Depth 4 }

function Invoke-GitConnect([string]$Url, [string]$Branch) {
    if (-not $Url) { Write-Bad "Укажите адрес репозитория."; return }
    if ($Branch -eq "auto") { $Branch = "" }
    if (-not (Find-Executable "git")) { Write-Bad "git не установлен: winget install Git.Git"; return }
    Write-Step "Подключение репозитория"
    if (-not (Test-Path (Join-Path $script:Root ".git"))) { Invoke-Git init | ForEach-Object { Write-Dim $_ } }
    [void](Invoke-Git remote remove origin)
    [void](Invoke-Git remote add origin $Url)
    $fetch = Invoke-Git fetch origin
    if ($script:GitExit -ne 0) { Write-Bad "Не удалось получить репозиторий: $(($fetch -join ' ').Trim())"; return }

    # Ветку берём ту, что указана; иначе ветку по умолчанию на сервере репозитория (main или master).
    [void](Invoke-Git remote set-head origin -a)
    $remoteHead = Invoke-Git symbolic-ref --short refs/remotes/origin/HEAD
    $candidates = @()
    if ($Branch) { $candidates += $Branch }
    if ($script:GitExit -eq 0 -and $remoteHead) { $candidates += ("$($remoteHead | Select-Object -First 1)" -replace "^origin/", "") }
    $candidates += @("main", "master")
    $chosen = $null
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        [void](Invoke-Git rev-parse --verify --quiet "refs/remotes/origin/$candidate")
        if ($script:GitExit -eq 0) { $chosen = $candidate; break }
    }
    if (-not $chosen) {
        $branches = (Invoke-Git branch -r | ForEach-Object { $_.Trim() }) -join ", "
        Write-Bad "В репозитории не найдена подходящая ветка. Есть: $branches"
        return
    }
    if ($Branch -and $chosen -ne $Branch) { Write-Warn "Ветки '$Branch' нет в репозитории - использую '$chosen'." }

    # Файлы остаются как есть - ветка только «наводится» на историю репозитория.
    [void](Invoke-Git reset --mixed "origin/$chosen")
    if ($script:GitExit -ne 0) { Write-Bad "Не удалось привязать ветку '$chosen'."; return }
    [void](Invoke-Git branch -M $chosen)
    [void](Invoke-Git branch --set-upstream-to="origin/$chosen" $chosen)
    Write-Good "Репозиторий подключён: $Url (ветка $chosen)."
}

function Invoke-UploadsScan([string]$Days, [string]$Mode) {
    if (-not (Test-Installed)) { return }
    Import-EnvFile $script:EnvFile | Out-Null
    $node = Find-Executable "node"
    $count = 30
    if ($Days) { [void][int]::TryParse($Days, [ref]$count) }
    & $node (Join-Path $PSScriptRoot "cleanup-uploads.mjs") $Mode $count
    if ($LASTEXITCODE -ne 0) { $script:HadError = $true }
}

function Invoke-Setup {
    $config = Read-EnvFile $script:EnvFile
    $first = ($config.Count -eq 0)
    Clear-Host
    Write-Host ""
    Show-Header
    Write-Host ""
    Write-Info $(if ($first) { "Первая установка." } else { "Повторная настройка: секреты и пароль админа сохранятся." })
    Write-Dim "Домен даёт доверенный HTTPS-сертификат. Без домена сайт откроется по IP с предупреждением браузера."
    Write-Host ""

    $currentDomain = $config["DEPLOY_DOMAIN"]
    $hint = if ($currentDomain) { " [$currentDomain, '-' = убрать]" } else { "" }
    $domain = (Read-Host "  Домен (Enter - $(if ($currentDomain) { 'оставить' } else { 'без домена' }))$hint").Trim()
    if ($domain -eq "-") { $domain = "" } elseif (-not $domain) { $domain = $currentDomain }
    $domain = $domain -replace "^https?://", "" -replace "/.*$", ""

    $setupArgs = @{ Domain = $domain }
    if ($first) {
        $email = (Read-Host "  Логин админа (Enter - admin)").Trim()
        if ($email) { $setupArgs["AdminEmail"] = $email }
        $password = Read-Host "  Пароль админа (Enter - создать случайный, от 8 символов)"
        if ($password) { $setupArgs["AdminPassword"] = $password }
    }

    $wasRunning = [bool](Get-ServerState)
    if ($wasRunning) { Write-Info "Сервер сейчас работает - остановлю на время установки."; Invoke-Stop }
    Write-Host ""
    try { & (Join-Path $PSScriptRoot "setup.ps1") @setupArgs }
    catch { Write-Bad $_.Exception.Message; return }

    if ((Test-LabPresent) -and ($script:AssumeYes -or (Read-Confirm "Настроить и «Заказы» (lab)?"))) {
        Write-Host ""
        Invoke-Lab setup

        # Сайт шлёт заказы в lab напрямую на localhost - оба на одном сервере, так надёжнее
        # и быстрее, чем идти через публичный домен и Caddy туда-обратно.
        $labEnvFile = Join-Path $script:LabRoot ".env"
        if (Test-Path $labEnvFile) {
            $labConfig = Read-EnvFile $labEnvFile
            if ($labConfig["PORT"]) {
                $siteConfig = Read-EnvFile $script:EnvFile
                $siteConfig["LAB_API_URL"] = "http://127.0.0.1:$($labConfig['PORT'])"
                Write-EnvFile $script:EnvFile $siteConfig
                Write-Ok "LAB_API_URL -> http://127.0.0.1:$($labConfig['PORT'])"
            }
        }
    }

    if ($wasRunning) { Invoke-Start }
    else { Write-Host ""; Write-Info "Запустите сервер пунктом [1]." }
}

function Invoke-Autostart {
    if (-not (Test-Installed)) { return }
    if (Get-AutostartTask) {
        if (Read-Confirm "Автозапуск включён. Выключить?") {
            & (Join-Path $PSScriptRoot "install-autostart.ps1") -Remove
        }
    }
    else {
        if (Read-Confirm "Включить запуск сервера вместе с Windows (без входа в систему)?") {
            & (Join-Path $PSScriptRoot "install-autostart.ps1")
        }
    }
    if ((Test-LabPresent) -and (Test-Path (Join-Path $script:LabRoot ".env"))) { Invoke-Lab autostart }
}

function Remove-Folder([string]$Path) {
    if (Test-Path $Path) { [void](Invoke-Native { & cmd.exe /c "rmdir /s /q `"$Path`"" }) }
}

function Clear-BuildAndLogs {
    $freed = 0
    $cache = Join-Path $script:Root ".next\cache"
    $freed += Get-FolderSize $cache
    Remove-Folder $cache
    if (Test-Path $script:LogDir) {
        Get-ChildItem -Path $script:LogDir -Filter "*.old" -ErrorAction SilentlyContinue | ForEach-Object { $freed += $_.Length; Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
        if (-not (Get-ServerState)) {
            Get-ChildItem -Path $script:LogDir -File -ErrorAction SilentlyContinue | ForEach-Object { $freed += $_.Length; Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue }
        }
    }
    Write-Good ("Кэш сборки и старые логи удалены, освобождено {0}." -f (Format-Size $freed))
}

function Clear-Uploads {
    if (-not (Test-Installed)) { return }
    Import-EnvFile $script:EnvFile | Out-Null
    $node = Find-Executable "node"
    $answer = (Read-Host "  Удалять модели без заказов старше скольки дней? (Enter - 30)").Trim()
    $days = 30
    if ($answer) { if (-not [int]::TryParse($answer, [ref]$days) -or $days -lt 1) { Write-Bad "Нужно целое число дней."; return } }

    $tool = Join-Path $PSScriptRoot "cleanup-uploads.mjs"
    $raw = (& $node $tool scan $days 2>&1 | Out-String).Trim()
    try { $scan = $raw | ConvertFrom-Json } catch { Write-Bad "Не удалось проверить загрузки: $raw"; return }

    Write-Host ""
    Write-Field "Без заказов" ("{0} файл. · {1}  (старше {2} дн.)" -f $scan.unused.count, (Format-Size $scan.unused.bytes), $days) "Gray"
    Write-Field "Без записи в БД" ("{0} файл. · {1}  (остатки замен и сбоев)" -f $scan.orphans.count, (Format-Size $scan.orphans.bytes)) "Gray"
    if (($scan.unused.count + $scan.orphans.count) -eq 0) { Write-Good "Лишнего нет."; return }
    Write-Host ""
    if (-not (Read-Confirm "Удалить это безвозвратно?")) { Write-Info "Отменено."; return }
    $raw = (& $node $tool delete $days 2>&1 | Out-String).Trim()
    try { $done = $raw | ConvertFrom-Json } catch { Write-Bad "Ошибка при удалении: $raw"; return }
    Write-Good ("Удалено: {0}." -f (Format-Size ($done.unused.bytes + $done.orphans.bytes)))
}

function Invoke-Cleanup {
    while ($true) {
        Show-Screen
        Write-Info "Очистка лишних файлов"
        Write-Host ""
        Write-MenuItem "1" "Кэш сборки и старые логи" "безопасно, пересоздаётся само"
        Write-MenuItem "2" "Неиспользуемые загрузки" "модели без заказов, файлы-сироты"
        Write-MenuItem "3" "Всё сразу"
        Write-MenuItem "0" "Назад"
        Write-Host ""
        Write-Host "  Выбор: " -NoNewline -ForegroundColor Gray
        $key = Read-MenuKey
        Write-Host ""
        switch ($key) {
            "1" { Clear-BuildAndLogs; Wait-AnyKey }
            "2" { Clear-Uploads; Wait-AnyKey }
            "3" { Clear-BuildAndLogs; Clear-Uploads; Wait-AnyKey }
            default { return }
        }
    }
}

function Invoke-Uninstall {
    Clear-Host
    Write-Host ""
    Show-Header
    Write-Host ""
    Write-Info "Будет удалено: автозапуск, правило брандмауэра, настройки (.env.production), логи и служебные файлы."
    Write-Good "Не затрагивается: база данных, папка uploads и сам код сайта."
    Write-Host ""
    if (-not $script:AssumeYes -and -not (Read-Confirm "Удалить установку сервера?")) { Write-Info "Отменено."; return }

    Stop-Server
    if (Get-AutostartTask) { Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction SilentlyContinue; Write-Ok "Автозапуск удалён." }
    Remove-NetFirewallRule -DisplayName "Lab3D web (80/443)" -ErrorAction SilentlyContinue
    Remove-Item $script:EnvFile, $script:CaddyFile, $script:StateFile, $script:StopFlag -Force -ErrorAction SilentlyContinue
    Remove-Folder $script:LogDir
    Write-Ok "Настройки, логи и служебные файлы удалены."

    $dropModules = if ($script:AssumeYes) { [bool]$RemoveModules } else { Read-Confirm "Удалить также node_modules и сборку .next? (вернутся при установке)" }
    if ($dropModules) {
        Write-Info "Удаляю node_modules и .next - это может занять до минуты, окно не завис..."
        Remove-Folder (Join-Path $script:Root "node_modules")
        Remove-Folder (Join-Path $script:Root ".next")
        Write-Ok "node_modules и .next удалены."
    }
    Write-Host ""
    Write-Good "Готово. Чтобы поставить заново - server.bat setup."
    Write-Dim "Сертификаты Caddy лежат в %APPDATA%\Caddy - их можно удалить вручную, если домен больше не нужен."
}

function Show-Menu {
    while ($true) {
        Show-Screen
        Write-MenuItem "1" "Запустить сервер" "в фоне: работает и после закрытия окна"
        Write-MenuItem "2" "Остановить сервер"
        Write-MenuItem "3" "Перезапустить"
        Write-MenuItem "4" "Логи" "живой просмотр"
        Write-MenuItem "5" "Обновить и пересобрать"
        Write-MenuItem "6" "Установка / смена домена"
        Write-MenuItem "7" "Автозапуск с Windows" "включить / выключить"
        Write-MenuItem "8" "Очистка лишних файлов"
        Write-MenuItem "9" "Удаление установки"
        Write-MenuItem "0" "Выход" "сервер продолжит работать"
        Write-Host ""
        Write-Host "  Выбор: " -NoNewline -ForegroundColor Gray
        $key = Read-MenuKey
        Write-Host ""
        try {
            switch ($key) {
                "1" { Invoke-Start; Wait-AnyKey }
                "2" { Invoke-Stop; Wait-AnyKey }
                "3" { Invoke-Restart; Wait-AnyKey }
                "4" { Invoke-Logs }
                "5" { Invoke-Update; Wait-AnyKey }
                "6" { Invoke-Setup; Wait-AnyKey }
                "7" { Invoke-Autostart; Wait-AnyKey }
                "8" { Invoke-Cleanup }
                "9" { Invoke-Uninstall; Wait-AnyKey }
                { $_ -in @("0", "q", "Q", [string][char]27) } {
                    Clear-Host
                    if (Get-ServerState) { Write-Good "Меню закрыто. Сервер продолжает работать в фоне." } else { Write-Info "Меню закрыто." }
                    return
                }
            }
        }
        catch { Write-Bad $_.Exception.Message; Wait-AnyKey }
    }
}

try {
    switch ($Command.ToLower()) {
        "menu" { Show-Menu }
        "start" { Invoke-Start }
        "stop" { Invoke-Stop }
        "restart" { Invoke-Restart }
        "status" { Write-Host ""; Show-Header; Write-Host ""; Show-Status; Show-LabStatus }
        "logs" { Invoke-Logs }
        "update" { Invoke-Update }
        "setup" { Invoke-Setup }
        "autostart" { Invoke-Autostart }
        "cleanup" { Invoke-Cleanup }
        "uninstall" { Invoke-Uninstall }
        "git-check" { Invoke-GitCheck }
        "git-connect" { Invoke-GitConnect $Rest[0] $Rest[1] }
        "cleanup-cache" { Clear-BuildAndLogs }
        "uploads-scan" { Invoke-UploadsScan $Rest[0] "scan" }
        "uploads-delete" { Invoke-UploadsScan $Rest[0] "delete" }
        default {
            Write-Bad "Неизвестная команда: $Command"
            Write-Info "Доступно: menu, start, stop, restart, status, logs, update, setup, autostart, cleanup, uninstall"
        }
    }
}
catch { Write-Bad $_.Exception.Message }

if ($Elevated -and $Command.ToLower() -ne "menu") { Wait-AnyKey "Нажмите любую клавишу, чтобы закрыть окно..." }

if ($script:HadError) { exit 1 }
