<#
.SYNOPSIS
  Запускает сайт при старте Windows (без входа в систему) и перезапускает его при сбое.

.EXAMPLE
  server.bat autostart                          # включить/выключить через меню
  powershell -File deploy\install-autostart.ps1 -Remove
#>
param([switch]$Remove)

. (Join-Path $PSScriptRoot "lib.ps1")

if (-not (Test-Admin)) { throw "Запустите от администратора (server.bat поднимает права сам)." }

if ($Remove) {
    Stop-ScheduledTask -TaskName $script:TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $script:TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Ok "Автозапуск выключен."
    return
}

if (-not (Test-Path $script:EnvFile)) { throw "Сначала выполните установку (server.bat setup)." }

$startScript = Join-Path $PSScriptRoot "start.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`"" -WorkingDirectory $script:Root
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Register-ScheduledTask -TaskName $script:TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Ok "Автозапуск включён: сайт стартует вместе с Windows."
Write-Warn "Задача работает от имени SYSTEM, поэтому Node.js должен быть установлен для всех пользователей (обычная установка через winget/MSI так и делает)."
if (-not (Get-ServerState)) { Write-Host "    Запустить прямо сейчас: Start-ScheduledTask -TaskName '$script:TaskName' (или пункт [1] в меню)" }
