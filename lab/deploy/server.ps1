<#
.SYNOPSIS
  Управление сервером заказов на Windows: меню и команды. Запускается через lab.bat.

.EXAMPLE
  lab.bat                # меню
  lab.bat start          # запустить в фоне
  lab.bat stop           # остановить
  lab.bat restart
  lab.bat status
  lab.bat logs           # живые логи (Q - выход)
  lab.bat update         # обновить (git pull + npm install)
  lab.bat setup          # установка / смена домена
  lab.bat autostart      # включить/выключить запуск вместе с Windows
  lab.bat uninstall
#>
param(
    [Parameter(Position = 0)][string]$Command = "menu",
    [Parameter(Position = 1, ValueFromRemainingArguments = $true)][string[]]$Rest = @(),
    [switch]$Elevated,
    [switch]$NoElevate,
    [switch]$Yes,
    [switch]$Force
)

. (Join-Path $PSScriptRoot "lib.ps1")
. (Join-Path $PSScriptRoot "ui.ps1")
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$OutputEncoding = New-Object Text.UTF8Encoding($false)
$Host.UI.RawUI.WindowTitle = "Заказы - сервер"
Set-Location $script:Root

if (-not $NoElevate -and -not (Test-Admin)) {
    try {
        $argList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath), $Command) + $Rest + "-Elevated"
        Start-Process -FilePath "powershell.exe" -Verb RunAs -ArgumentList $argList
    }
    catch { Write-Bad "Нужны права администратора, а запрос UAC был отклонён." }
    return
}

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
        Write-Field "Процесс" ("PID {0}" -f $state.appPid) "Gray"
    }
    elseif ($state) {
        Write-Field "Статус" "● Запускается или перезапускается..." "Yellow"
        Write-Field "Адрес" $state.url "Cyan"
    }
    else {
        Write-Field "Статус" "○ Остановлен" "Red"
        $target = if ($config["DEPLOY_DOMAIN"]) { "https://" + $config["DEPLOY_DOMAIN"] } else { "http://127.0.0.1:$($config['PORT'])" }
        Write-Field "Адрес" $target "DarkGray"
    }

    $task = Get-AutostartTask
    Write-Field "Автозапуск" $(if ($task) { "включён (стартует вместе с Windows)" } else { "выключен" }) $(if ($task) { "Green" } else { "DarkGray" })
    $dataSize = Format-Size (Get-FolderSize (Join-Path $script:Root "data"))
    Write-Field "Диск" "данные $dataSize" "Gray"
}

function Show-Screen {
    Clear-Host
    Write-Host ""
    Show-Header
    Write-Host ""
    Show-Status
    Write-Host ""
    Write-Rule
}

function Test-Installed {
    if (Test-Path $script:EnvFile) { return $true }
    Write-Bad "Сервер ещё не установлен. Выберите «Установка» в меню (lab.bat setup)."
    return $false
}

function Invoke-Start {
    if (-not (Test-Installed)) { return }
    if (Get-ServerState) { Write-Info "Сервер уже запущен."; return }

    $config = Import-EnvFile $script:EnvFile
    $owner = Get-PortOwner ([int]$config["PORT"])
    if ($owner) { Write-Bad "Порт $($config['PORT']) занят: $owner."; return }

    $procId = Start-Detached ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $script:StartScript) $script:Root
    $ok = Show-Spinner { $s = Read-State; ($s -and $s.ready) -or -not (Test-ProcAlive $procId $null) } "Запускаю сервер" 60
    $state = Get-ServerState
    if ($ok -and $state -and $state.ready) {
        Write-Good "Сервер запущен и работает в фоне. Терминал можно закрыть."
        Write-Field "Адрес" $state.url "Cyan"
    }
    else {
        Write-Bad "Сервер не запустился. Последние события:"
        $log = Join-Path $script:LogDir "supervisor.log"
        if (Test-Path $log) { Get-Content -Path $log -Tail 8 -Encoding UTF8 | ForEach-Object { Write-Dim $_ } }
    }
}

function Invoke-Stop {
    if (-not (Read-State)) { Write-Info "Сервер и так остановлен."; return }
    Write-Info "Останавливаю сервер..."
    Stop-Server
    Write-Good "Сервер остановлен."
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
        Write-MenuItem "1" "Сервер" "вывод приложения"
        Write-MenuItem "2" "Ошибки" "app-error.log"
        Write-MenuItem "3" "События" "запуски, падения, перезапуски"
        Write-MenuItem "0" "Назад"
        Write-Host ""
        Write-Host "  Выбор: " -NoNewline -ForegroundColor Gray
        switch (Read-MenuKey) {
            "1" { Show-LogTail (Join-Path $script:LogDir "app.log") "Сервер" }
            "2" { Show-LogTail (Join-Path $script:LogDir "app-error.log") "Ошибки" }
            "3" { Show-LogTail (Join-Path $script:LogDir "supervisor.log") "События" }
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
    $installed = Test-Path $script:EnvFile
    $wasRunning = $installed -and [bool](Get-ServerState)
    if ($wasRunning) { Invoke-Stop }
    if ($installed) { Import-EnvFile $script:EnvFile | Out-Null }

    if ((Test-Path (Join-Path $script:Root ".git")) -and ($script:AssumeYes -or (Read-Confirm "Скачать свежий код (git pull)?"))) {
        if (-not (Update-FromGit)) { if ($wasRunning) { Invoke-Start }; return }
    }
    if (-not $installed) {
        Write-Good "Код обновлён. Сервер здесь не установлен, поэтому зависимости и перезапуск пропущены."
        return
    }
    Write-Step "Зависимости"; & npm install --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Write-Bad "npm install не удался."; return }
    Write-Good "Обновление завершено."
    if ($wasRunning) { Invoke-Start }
    else { Write-Info "Сервер был остановлен - запустите его пунктом [1]." }
}

function Invoke-Setup {
    $config = Read-EnvFile $script:EnvFile
    $first = ($config.Count -eq 0)
    Clear-Host
    Write-Host ""
    Show-Header
    Write-Host ""
    Write-Info $(if ($first) { "Первая установка." } else { "Повторная настройка: пароль администратора не трогается, если не задать новый." })
    Write-Host ""

    $currentDomain = $config["DEPLOY_DOMAIN"]
    $hint = if ($currentDomain) { " [$currentDomain, '-' = убрать]" } else { " [crm.lab-3d.pro]" }
    $domain = (Read-Host "  Поддомен (Enter - $(if ($currentDomain) { 'оставить' } else { 'crm.lab-3d.pro' }))$hint").Trim()
    if ($domain -eq "-") { $domain = "" } elseif (-not $domain) { $domain = $currentDomain }

    $setupArgs = @{ Domain = $domain }
    if ($first) {
        $username = (Read-Host "  Логин администратора (Enter - admin)").Trim()
        if ($username) { $setupArgs["AdminUsername"] = $username }
        $password = Read-Host "  Пароль администратора (Enter - создать случайный)"
        if ($password) { $setupArgs["AdminPassword"] = $password }
    }

    $wasRunning = [bool](Get-ServerState)
    if ($wasRunning) { Write-Info "Сервер сейчас работает - остановлю на время установки."; Invoke-Stop }
    Write-Host ""
    try { & (Join-Path $PSScriptRoot "setup.ps1") @setupArgs }
    catch { Write-Bad $_.Exception.Message; return }
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
}

function Invoke-Uninstall {
    Clear-Host
    Write-Host ""
    Show-Header
    Write-Host ""
    Write-Info "Будет удалено: автозапуск, настройки (.env), логи и служебные файлы."
    Write-Good "Не затрагивается: база данных (data\orders.db) и сам код."
    Write-Host ""
    if (-not $script:AssumeYes -and -not (Read-Confirm "Удалить установку сервера?")) { Write-Info "Отменено."; return }

    Stop-Server
    if (Get-AutostartTask) { Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction SilentlyContinue; Write-Ok "Автозапуск удалён." }
    Remove-Item $script:EnvFile, $script:StateFile, $script:StopFlag -Force -ErrorAction SilentlyContinue
    if (Test-Path $script:LogDir) { [void](Invoke-Native { & cmd.exe /c "rmdir /s /q `"$script:LogDir`"" }) }
    Write-Ok "Настройки, логи и служебные файлы удалены."
    Write-Host ""
    Write-Good "Готово. Чтобы поставить заново - lab.bat setup."
    Write-Dim "Site-блок в New_Lab_3d\deploy\sites.d\lab.caddy остался - удалите вручную, если больше не нужен."
}

function Show-Menu {
    while ($true) {
        Show-Screen
        Write-MenuItem "1" "Запустить сервер" "в фоне: работает и после закрытия окна"
        Write-MenuItem "2" "Остановить сервер"
        Write-MenuItem "3" "Перезапустить"
        Write-MenuItem "4" "Логи" "живой просмотр"
        Write-MenuItem "5" "Обновить" "git pull + npm install"
        Write-MenuItem "6" "Установка / смена домена"
        Write-MenuItem "7" "Автозапуск с Windows" "включить / выключить"
        Write-MenuItem "8" "Удаление установки"
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
                "8" { Invoke-Uninstall; Wait-AnyKey }
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
        "status" { Write-Host ""; Show-Header; Write-Host ""; Show-Status }
        "logs" { Invoke-Logs }
        "update" { Invoke-Update }
        "setup" { Invoke-Setup }
        "autostart" { Invoke-Autostart }
        "uninstall" { Invoke-Uninstall }
        default {
            Write-Bad "Неизвестная команда: $Command"
            Write-Info "Доступно: menu, start, stop, restart, status, logs, update, setup, autostart, uninstall"
        }
    }
}
catch { Write-Bad $_.Exception.Message }

if ($Elevated -and $Command.ToLower() -ne "menu") { Wait-AnyKey "Нажмите любую клавишу, чтобы закрыть окно..." }

if ($script:HadError) { exit 1 }
