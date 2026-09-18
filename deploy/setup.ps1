<#
.SYNOPSIS
  Установка/перенастройка сервера на Windows со статическим IP (как на VPS).

.EXAMPLE
  server.bat setup                     # интерактивно
  npm run server:setup -- -Domain lab-3d.pro

.NOTES
  Можно запускать повторно: секреты и пароль админа сохраняются. Так же меняют домен.
  Для правил брандмауэра нужен запуск от администратора (server.bat поднимает права сам).
#>
param(
    [string]$Domain = "",
    [string]$Ip = "",
    [string]$DatabaseUrl = "",
    [string]$AdminEmail = "admin",
    [string]$AdminPassword = "",
    [int]$AppPort = 3000,
    [switch]$SkipFirewall,
    [switch]$SkipBuild
)

. (Join-Path $PSScriptRoot "lib.ps1")
Set-Location $script:Root

Write-Step "Проверка Node.js"
$node = Find-Executable "node"
if (-not $node) { throw "Node.js не установлен. Установите: winget install OpenJS.NodeJS.LTS" }
$nodeVersion = [Version]((& $node -v).TrimStart('v'))
if ($nodeVersion -lt [Version]"20.9.0") { throw "Нужен Node.js 20.9 или новее (сейчас $nodeVersion)." }
Write-Ok "Node.js $nodeVersion"

$existing = Read-EnvFile $script:EnvFile
$firstRun = ($existing.Count -eq 0)

Write-Step "Сеть"
if (-not $Ip) { $Ip = Get-LocalIp }
$publicIp = Get-PublicIp
Write-Ok "IP сервера: $Ip"
if ($publicIp -and $publicIp -ne $Ip) {
    Write-Warn "Внешний IP: $publicIp. Компьютер за роутером - пробросьте TCP-порты 80 и 443 на $Ip."
}
if ($Domain) {
    $resolved = Resolve-DnsName -Name $Domain -Type A -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq "A" } | Select-Object -First 1
    $expected = if ($publicIp) { $publicIp } else { $Ip }
    if (-not $resolved) { Write-Warn "Домен $Domain пока не резолвится. Создайте DNS-запись A: $Domain -> $expected" }
    elseif ($resolved.IPAddress -ne $expected) { Write-Warn "$Domain указывает на $($resolved.IPAddress), а сервер - $expected. HTTPS не заработает, пока они не совпадут." }
    else { Write-Ok "$Domain -> $($resolved.IPAddress)" }
}

Write-Step "База данных"
if (-not $DatabaseUrl) { $DatabaseUrl = $existing["DATABASE_URL"] }
if (-not $DatabaseUrl) {
    Write-Host "    Нужен PostgreSQL. Установка: winget install PostgreSQL.PostgreSQL.17"
    Write-Host "    Пример: postgresql://postgres:ВАШ_ПАРОЛЬ@localhost:5432/formnow"
    $DatabaseUrl = Read-Host "    DATABASE_URL"
}
$env:DATABASE_URL = $DatabaseUrl
& $node (Join-Path $PSScriptRoot "ensure-db.mjs")
if ($LASTEXITCODE -ne 0) { throw "Нет связи с базой данных. Проверьте DATABASE_URL и что PostgreSQL запущен." }

Write-Step "Запись .env.production"
$baseUrl = if ($Domain) { "https://$Domain" } else { "https://$Ip" }
$settings = [ordered]@{}
foreach ($key in $existing.Keys) { $settings[$key] = $existing[$key] }
$settings["DATABASE_URL"] = $DatabaseUrl
if (-not $settings["AUTH_SECRET"] -or $settings["AUTH_SECRET"] -like "replace-with*") { $settings["AUTH_SECRET"] = New-Secret 48 }
$settings["AUTH_TRUST_HOST"] = "true"
$settings["APP_URL"] = $baseUrl
$settings["NEXT_PUBLIC_APP_URL"] = $baseUrl
if (-not $settings["NEXT_PUBLIC_RUB_PER_USD"]) { $settings["NEXT_PUBLIC_RUB_PER_USD"] = "90" }
foreach ($key in @("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY")) {
    if (-not $settings.Contains($key)) { $settings[$key] = "" }
}
$settings["DEPLOY_DOMAIN"] = $Domain
$settings["DEPLOY_IP"] = $Ip
$settings["APP_PORT"] = "$AppPort"
$settings["DEPLOY_NODE"] = $node
$caddy = Find-Caddy
if ($caddy) { $settings["DEPLOY_CADDY"] = $caddy }
Write-EnvFile $script:EnvFile $settings
Import-EnvFile $script:EnvFile | Out-Null
Write-Ok $script:EnvFile

Write-Step "Установка зависимостей"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой." }

Write-Step "Подготовка базы данных"
& npx prisma generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate завершился с ошибкой." }
& npx prisma db push
if ($LASTEXITCODE -ne 0) { throw "prisma db push завершился с ошибкой." }

$generatedPassword = $false
if (-not $AdminPassword -and $firstRun) { $AdminPassword = (New-Secret 12); $generatedPassword = $true }
$env:ADMIN_EMAIL = $AdminEmail
$env:NODE_ENV = "production"
if ($AdminPassword) { $env:ADMIN_PASSWORD = $AdminPassword } else { Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue }
& npx tsx prisma/seed.ts
$seedExit = $LASTEXITCODE
Remove-Item Env:NODE_ENV, Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
if ($seedExit -ne 0) { throw "Заполнение базы завершилось с ошибкой." }

if (-not $SkipBuild) {
    Write-Step "Сборка сайта (нужен интернет для шрифтов Google)"
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw "Сборка не удалась." }
}

Write-Step "Брандмауэр Windows"
if ($SkipFirewall) { Write-Warn "Пропущено." }
elseif (-not (Test-Admin)) { Write-Warn "Нет прав администратора - откройте порты 80 и 443 вручную или запустите через server.bat." }
else {
    if (-not (Get-NetFirewallRule -DisplayName "Lab3D web (80/443)" -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName "Lab3D web (80/443)" -Direction Inbound -Protocol TCP -LocalPort 80, 443 -Action Allow | Out-Null
    }
    Write-Ok "Входящие TCP 80 и 443 разрешены."
}

Write-Step "Caddy (HTTPS-прокси)"
if ($caddy) { Write-Ok $caddy }
else { Write-Warn "Caddy не установлен: winget install CaddyServer.Caddy  (потом повторите установку)" }

Write-Host ""
Write-Host "  Установка завершена." -ForegroundColor Green
Write-Host "  Адрес : $baseUrl"
if ($AdminPassword) {
    Write-Host "  Админ : $AdminEmail"
    if ($generatedPassword) { Write-Host "  Пароль: $AdminPassword   <- показан один раз, сохраните" -ForegroundColor Yellow }
}
if (-not $Domain) { Write-Host "  Без домена браузер покажет предупреждение о сертификате. Домен даёт доверенный сертификат." -ForegroundColor DarkGray }
