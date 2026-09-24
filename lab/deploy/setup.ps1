<#
.SYNOPSIS
  Установка/перенастройка lab на том же сервере, где уже стоит New_Lab_3d (использует его
  общий Caddy/брандмауэр - здесь ничего из этого не поднимается заново).

.EXAMPLE
  lab.bat setup                     # интерактивно
  npm run server:setup -- -Domain crm.lab-3d.pro

.NOTES
  Можно запускать повторно: пароль администратора не трогается, если не задать новый.
#>
param(
    [string]$Domain = "",
    [int]$Port = 3001,
    [string]$NewLab3dRoot = "",
    [string]$AdminUsername = "admin",
    [string]$AdminPassword = "",
    [switch]$SkipReload
)

. (Join-Path $PSScriptRoot "lib.ps1")
Set-Location $script:Root

Write-Step "Проверка Node.js"
$node = Find-Executable "node"
if (-not $node) { throw "Node.js не установлен. Установите: winget install OpenJS.NodeJS.LTS" }
Write-Ok "Node.js $((& $node -v))"

Write-Step "Установка зависимостей"
& npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw "npm install завершился с ошибкой." }

$existing = Read-EnvFile $script:EnvFile
$firstRun = ($existing.Count -eq 0)

Write-Step "Сеть"
$ip = Get-LocalIp
Write-Ok "IP сервера: $ip"

# По умолчанию - родительская папка: lab теперь живёт внутри репозитория New_Lab_3d
# (New_Lab_3d/lab/), поэтому её Caddy/HTTPS всегда на уровень выше, без хардкода пути.
if (-not $NewLab3dRoot) { $NewLab3dRoot = $existing["NEW_LAB_3D_ROOT"] }
if (-not $NewLab3dRoot) { $NewLab3dRoot = Split-Path -Parent $script:Root }
$newLab3dEnv = Join-Path $NewLab3dRoot ".env.production"
if (-not (Test-Path $newLab3dEnv)) {
    Write-Warn "Не нашёл установленный New_Lab_3d по пути '$NewLab3dRoot' ($newLab3dEnv отсутствует)."
    Write-Warn "Сайт всё равно поставится, но за общий HTTPS/домен отвечает Caddy у New_Lab_3d - настройте его отдельно, когда он появится."
}
else {
    $newLab3dConfig = Read-EnvFile $newLab3dEnv
    if ($newLab3dConfig["DEPLOY_IP"]) { $ip = $newLab3dConfig["DEPLOY_IP"] }
}

if (-not $Domain) { $Domain = $existing["DEPLOY_DOMAIN"] }
if (-not $Domain) { $Domain = "crm.lab-3d.pro" }
if ($Domain) {
    $resolved = Resolve-DnsName -Name $Domain -Type A -ErrorAction SilentlyContinue | Where-Object { $_.Type -eq "A" } | Select-Object -First 1
    if (-not $resolved) { Write-Warn "Домен $Domain пока не резолвится. Создайте DNS-запись A: $Domain -> $ip" }
    elseif ($resolved.IPAddress -ne $ip) { Write-Warn "$Domain указывает на $($resolved.IPAddress), а сервер - $ip." }
    else { Write-Ok "$Domain -> $($resolved.IPAddress)" }
}

Write-Step "Запись .env"
$settings = [ordered]@{}
foreach ($key in $existing.Keys) { $settings[$key] = $existing[$key] }
$settings["PORT"] = "$Port"
$settings["DEPLOY_DOMAIN"] = $Domain
$settings["DEPLOY_IP"] = $ip
$settings["DEPLOY_NODE"] = $node
$settings["NEW_LAB_3D_ROOT"] = $NewLab3dRoot
Write-EnvFile $script:EnvFile $settings
Write-Ok $script:EnvFile

Write-Step "Администратор"
$generatedPassword = $false
if (-not $AdminPassword -and $firstRun) { $AdminPassword = (New-Secret 12); $generatedPassword = $true }
if ($AdminPassword) {
    $env:ADMIN_USERNAME = $AdminUsername
    $env:ADMIN_PASSWORD = $AdminPassword
    $env:NODE_ENV = "production"
    & $node (Join-Path $PSScriptRoot "create-admin.mjs")
    $adminExit = $LASTEXITCODE
    Remove-Item Env:NODE_ENV, Env:ADMIN_PASSWORD, Env:ADMIN_USERNAME -ErrorAction SilentlyContinue
    if ($adminExit -ne 0) { throw "Не удалось создать администратора." }
}
else {
    Write-Ok "Пароль администратора не менялся."
}

if (Test-Path $newLab3dEnv) {
    Write-Step "Подключение к общему Caddy (New_Lab_3d)"
    $sitesDir = Join-Path $NewLab3dRoot "deploy\sites.d"
    New-Item -ItemType Directory -Force -Path $sitesDir | Out-Null
    $siteFile = Join-Path $sitesDir "lab.caddy"
    [IO.File]::WriteAllText($siteFile, (New-LabCaddySiteText $Domain $ip $Port), (New-Object Text.UTF8Encoding($false)))
    Write-Ok $siteFile

    if (-not $SkipReload) {
        $newLab3dConfig = Read-EnvFile $newLab3dEnv
        $caddy = if ($newLab3dConfig["DEPLOY_CADDY"] -and (Test-Path $newLab3dConfig["DEPLOY_CADDY"])) { $newLab3dConfig["DEPLOY_CADDY"] } else { Find-Caddy }
        $newLab3dCaddyfile = Join-Path $NewLab3dRoot "deploy\Caddyfile"
        if ($caddy -and (Test-Path $newLab3dCaddyfile)) {
            $reload = Invoke-Native { & $caddy reload --config $newLab3dCaddyfile --adapter caddyfile }
            if ($reload.ExitCode -eq 0) { Write-Ok "Caddy подхватил новый сайт без перезапуска." }
            else { Write-Warn "Не удалось перезагрузить Caddy сейчас - подхватит при следующем запуске/перезапуске New_Lab_3d ($($reload.Output -join ' '))." }
        }
        else {
            Write-Warn "Caddy у New_Lab_3d сейчас не запущен - сайт lab подключится при следующем его запуске."
        }
    }
}

Write-Host ""
Write-Host "  Установка завершена." -ForegroundColor Green
Write-Host "  Адрес : $(if ($Domain) { "https://$Domain" } else { "http://${ip}:$Port" })"
if ($AdminPassword) {
    Write-Host "  Админ : $AdminUsername"
    if ($generatedPassword) { Write-Host "  Пароль: $AdminPassword   <- показан один раз, сохраните" -ForegroundColor Yellow }
}
