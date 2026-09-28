<#
.SYNOPSIS
  Окно управления сервером «Лаборатория 3Д» (запускается через Lab3D.exe).
  Показывает статус, запускает/останавливает сайт, читает логи, обновляет код из git.

.NOTES
  Сам сайт работает отдельным фоновым процессом: закрытие окна его не останавливает.
  Все действия выполняет deploy\server.ps1 - окно только показывает их вывод.
  -Snapshot <папка> рисует страницы в PNG и выходит (для проверки внешнего вида).
#>
param([string]$Snapshot = "")

. (Join-Path $PSScriptRoot "lib.ps1")
Set-Location $script:Root

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Собственные элементы (скруглённые кнопки, карточки, поля...) компилируются один раз и кэшируются в deploy\controls-<хэш>.dll.
function Import-Controls {
    $source = Join-Path $PSScriptRoot "controls.cs"
    $hash = (Get-FileHash -Path $source -Algorithm SHA256).Hash.Substring(0, 12)
    $dll = Join-Path $PSScriptRoot "controls-$hash.dll"
    $refs = @("System.Windows.Forms.dll", "System.Drawing.dll")
    if ("Lab3D.RoundButton" -as [type]) { return }
    if (-not (Test-Path $dll)) {
        $code = [IO.File]::ReadAllText($source, [Text.Encoding]::UTF8)
        try {
            Get-ChildItem -Path $PSScriptRoot -Filter "controls-*.dll" -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
            Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -OutputAssembly $dll -OutputType Library -Language CSharp
        }
        catch { $dll = $null }
        if (-not $dll -or -not (Test-Path $dll)) { Add-Type -TypeDefinition $code -ReferencedAssemblies $refs -Language CSharp; return }
    }
    if (-not ("Lab3D.RoundButton" -as [type])) { Add-Type -Path $dll }
}
Import-Controls

[void][Lab3D.Native]::SetProcessDPIAware()

# Масштаб экрана Windows (125%, 150%...). Шрифты в пунктах растут вместе с ним сами, а координаты и
# размеры элементов заданы для 100% - их окно пересчитывает само (Form.Scale перед показом).
# LAB3D_UI_SCALE=1.5 имитирует такой экран на обычном мониторе (тогда растут и шрифты) - для -Snapshot.
$script:ScreenDpi = 96
try { $probe = [Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $script:ScreenDpi = $probe.DpiX; $probe.Dispose() } catch { }
$script:UiScale = $script:ScreenDpi / 96
$script:FontBoost = 1
if ($env:LAB3D_UI_SCALE) { $script:UiScale = [double]$env:LAB3D_UI_SCALE; $script:FontBoost = $script:UiScale }
[Windows.Forms.Application]::EnableVisualStyles()

$script:ServerScript = Join-Path $PSScriptRoot "server.ps1"
$script:SettingsFile = Join-Path $PSScriptRoot "app-settings.json"
$script:AppHash = (Get-FileHash -Path $PSCommandPath -Algorithm SHA256).Hash

# lab («Заказы») живёт в подпапке lab/ этого же репозитория и управляется своими
# deploy-скриптами - НЕ дот-сорсим lab/deploy/lib.ps1 (те же имена $script:Root и т.д.,
# перезатрёт наши), просто читаем его файлы состояния напрямую по вычисленным путям.
$script:LabRoot = Join-Path $script:Root "lab"
$script:LabServerScript = Join-Path $script:LabRoot "deploy\server.ps1"
$script:LabEnvFile = Join-Path $script:LabRoot ".env"
$script:LabStateFile = Join-Path $script:LabRoot "deploy\state.json"
$script:LabLogDir = Join-Path $script:LabRoot "deploy\logs"
$script:LabTaskName = "Lab CRM Server"
function Test-LabPresent { Test-Path $script:LabServerScript }

function Read-LabState {
    if (-not (Test-Path $script:LabStateFile)) { return $null }
    try { return (Get-Content -Path $script:LabStateFile -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}
function Get-LabServerState {
    $state = Read-LabState
    if ($state -and (Test-ProcAlive $state.supervisorPid $state.supervisorStart)) { return $state }
    return $null
}
function Get-LabAutostartTask { return Get-ScheduledTask -TaskName $script:LabTaskName -ErrorAction SilentlyContinue }

# ---------------------------------------------------------------- палитра
function New-Color([int]$R, [int]$G, [int]$B) { return [Drawing.Color]::FromArgb($R, $G, $B) }
$ColBg = New-Color 10 10 12
$ColSide = New-Color 14 14 17
$ColCard = New-Color 21 21 25
$ColField = New-Color 30 30 35
$ColLine = New-Color 42 42 48
$ColInk = New-Color 238 238 240
$ColMuted = New-Color 140 140 150
$ColAccent = New-Color 127 191 127
$ColAccentDark = New-Color 10 30 12
$ColRed = New-Color 232 108 108
$ColYellow = New-Color 232 190 90
$ColBlue = New-Color 110 190 220
$ColConsole = New-Color 13 13 16
$ColEmpty = [Drawing.Color]::Empty

# Пиксели макета (при 100%) в пиксели экрана - для размеров, которые считаются уже после масштабирования.
function Px([double]$Value) { return [int][Math]::Round($Value * $script:UiScale) }

function G([int]$Code) { return [string][char]$Code }

# ---------------------------------------------------------------- виджеты
function New-Font([single]$Size = 10, [bool]$Bold = $false) {
    $family = if ($Bold) { "Segoe UI Semibold" } else { "Segoe UI" }
    return New-Object Drawing.Font($family, ($Size * $script:FontBoost), [Drawing.FontStyle]::Regular)
}

function New-Label([string]$Content, [single]$Size = 10, $Color = $ColInk, [bool]$Bold = $false, $Back = $ColCard) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $Content
    $label.AutoSize = $true
    $label.ForeColor = $Color
    $label.BackColor = $Back
    $label.Font = New-Font $Size $Bold
    return $label
}

function New-Button([string]$Content, [string]$Kind = "secondary", [int]$Width = 160, [string]$Glyph = "") {
    $b = New-Object Lab3D.RoundButton
    $b.Text = $Content
    $b.Glyph = $Glyph
    $b.Width = $Width
    $b.Height = 42
    $b.Font = New-Font 10 $true
    $b.Margin = New-Object Windows.Forms.Padding(0, 0, 10, 0)
    switch ($Kind) {
        "primary" {
            $b.Fill = $ColAccent; $b.HoverFill = New-Color 152 210 152; $b.PressFill = New-Color 104 164 104; $b.Ink = $ColAccentDark
            $b.OffFill = New-Color 30 46 33; $b.OffInk = New-Color 92 118 94
        }
        "danger" {
            $b.Fill = $ColCard; $b.HoverFill = New-Color 46 26 28; $b.PressFill = New-Color 36 20 22; $b.Edge = New-Color 150 74 74; $b.Ink = $ColRed
            $b.OffFill = $ColCard; $b.OffInk = New-Color 90 70 72; $b.OffEdge = $ColLine
        }
        "ghost" {
            $b.Fill = $ColEmpty; $b.HoverFill = $ColField; $b.PressFill = $ColLine; $b.Ink = $ColMuted
            $b.OffFill = $ColEmpty; $b.OffInk = New-Color 80 80 88
        }
        default {
            $b.Fill = $ColField; $b.HoverFill = New-Color 40 40 47; $b.PressFill = New-Color 26 26 31; $b.Edge = $ColLine; $b.Ink = $ColInk
            $b.OffFill = $ColCard; $b.OffInk = New-Color 86 86 94; $b.OffEdge = $ColLine
        }
    }
    return $b
}

$script:Tips = New-Object Windows.Forms.ToolTip

# «localhost» в правом верхнем углу карточки сервиса: открывает его напрямую на этом компьютере,
# в обход домена и HTTPS. Адрес (Tag) и подсказку выставляет Update-*Status.
function New-LocalButton($Card) {
    $b = New-Button "localhost" "ghost" 130 (G 0xE7F4)
    $b.Height = 32
    $b.Anchor = "Top,Right"
    $b.Location = New-Object Drawing.Point(($Card.Width - 146), 16)
    $b.Add_Click({ if ($this.Tag) { Start-Process ([string]$this.Tag) } })
    $Card.Controls.Add($b)
    return $b
}

function Set-LocalButton($Button, [int]$Port, [bool]$Running) {
    $url = "http://localhost:$Port"
    if ($Button.Tag -ne $url) { $Button.Tag = $url; $script:Tips.SetToolTip($Button, "$url - открыть на этом компьютере") }
    $Button.Enabled = $Running
}

function New-Card($Fill = $ColCard, [int]$Radius = 16) {
    $card = New-Object Lab3D.CardPanel
    $card.Fill = $Fill
    $card.Edge = $ColLine
    $card.Radius = $Radius
    $card.BackColor = $Fill
    return $card
}

function New-Input([string]$Value = "", [bool]$Secret = $false, [string]$Hint = "") {
    $box = New-Object Lab3D.RoundTextBox
    $box.Fill = $ColField
    $box.Edge = $ColLine
    $box.FocusEdge = $ColAccent
    $box.Font = New-Font 10
    $box.Inner.ForeColor = $ColInk
    $box.Text = $Value
    $box.Secret = $Secret
    if ($Hint) { $box.Cue = $Hint }
    $box.Dock = "Fill"
    $box.Margin = New-Object Windows.Forms.Padding(0, 8, 0, 8)
    return $box
}

function New-Toggle([string]$Content, [int]$Width = 520) {
    $t = New-Object Lab3D.ToggleSwitch
    $t.Text = $Content
    $t.Width = $Width
    $t.Font = New-Font 10
    $t.OnColor = $ColAccent
    $t.OffColor = New-Color 62 62 70
    $t.Knob = New-Color 246 246 246
    $t.Ink = $ColInk
    return $t
}

function New-Table([string[]]$Rows, [int]$Columns = 1) {
    $table = New-Object Windows.Forms.TableLayoutPanel
    $table.Dock = "Fill"
    $table.BackColor = $ColBg
    $table.ColumnCount = $Columns
    for ($c = 0; $c -lt $Columns; $c++) { [void]$table.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", (100 / $Columns)))) }
    $table.RowCount = $Rows.Count
    foreach ($row in $Rows) {
        if ($row -eq "*") { [void]$table.RowStyles.Add((New-Object Windows.Forms.RowStyle("Percent", 100))) }
        elseif ($row -eq "auto") { [void]$table.RowStyles.Add((New-Object Windows.Forms.RowStyle("AutoSize"))) }
        else { [void]$table.RowStyles.Add((New-Object Windows.Forms.RowStyle("Absolute", [int]$row))) }
    }
    return $table
}

function Set-DarkScroll($Control) {
    try { [void][Lab3D.Native]::SetWindowTheme($Control.Handle, "DarkMode_Explorer", $null) } catch { }
}

function New-Console {
    $box = New-Object Windows.Forms.RichTextBox
    $box.BackColor = $ColConsole
    $box.ForeColor = $ColMuted
    $box.BorderStyle = "None"
    $box.ReadOnly = $true
    $box.Font = New-Object Drawing.Font("Consolas", (9.5 * $script:FontBoost))
    $box.Dock = "Fill"
    $box.DetectUrls = $false
    $box.HideSelection = $false
    $box.Add_HandleCreated({ Set-DarkScroll $this })
    return $box
}

# Тёмная скруглённая «панель» с консольным текстом внутри.
function New-ConsoleCard($Box) {
    $card = New-Card $ColConsole 12
    $card.Dock = "Fill"
    $card.Padding = New-Object Windows.Forms.Padding(14, 12, 8, 12)
    $card.Controls.Add($Box)
    return $card
}

function Add-ConsoleText($Box, [string]$Content, $Color = $null) {
    if (-not $Content) { return }
    if (-not $Color) { $Color = $ColMuted }
    if ($Box.TextLength -gt 250000) { $Box.Select(0, 100000); $Box.SelectedText = "" }
    $Box.SelectionStart = $Box.TextLength
    $Box.SelectionLength = 0
    $Box.SelectionColor = $Color
    $Box.AppendText($Content)
    $Box.SelectionStart = $Box.TextLength
    $Box.ScrollToCaret()
}

# Раскрашивает вывод построчно: ошибки красным, шаги голубым, предупреждения жёлтым.
function Add-ColoredLines($Box, [string]$Raw) {
    $clean = ($Raw -replace "\x1b\[[0-9;?]*[A-Za-z]", "") -replace "`r`n", "`n" -replace "`r", "`n"
    foreach ($line in ($clean -split "`n")) {
        if ($line -eq "") { continue }
        $color = $ColMuted
        if ($line -match "^\s*==>") { $color = $ColBlue }
        elseif ($line -match "ошибк|error|не удал|не найден|не запустил|failed|fatal") { $color = $ColRed }
        elseif ($line -match "warn|предупрежд|\s!\s") { $color = $ColYellow }
        elseif ($line -match "готово|запущен|остановлен|завершен|актуал|обновлён|подключён") { $color = $ColAccent }
        Add-ConsoleText $Box ($line + "`n") $color
    }
}

function Read-Appended([string]$Path, [ref]$Position) {
    if (-not (Test-Path $Path)) { return "" }
    try {
        $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
        try {
            if ($stream.Length -lt $Position.Value) { $Position.Value = 0 }
            if ($stream.Length -eq $Position.Value) { return "" }
            [void]$stream.Seek($Position.Value, [IO.SeekOrigin]::Begin)
            $buffer = New-Object byte[] ($stream.Length - $Position.Value)
            $read = $stream.Read($buffer, 0, $buffer.Length)
            $Position.Value += $read
            return [Text.Encoding]::UTF8.GetString($buffer, 0, $read).TrimStart([char]0xFEFF)
        }
        finally { $stream.Dispose() }
    }
    catch { return "" }
}

function Get-Settings {
    $defaults = [ordered]@{ autoCheck = $true }
    if (Test-Path $script:SettingsFile) {
        try { $saved = Get-Content $script:SettingsFile -Raw -Encoding UTF8 | ConvertFrom-Json; if ($null -ne $saved.autoCheck) { $defaults.autoCheck = [bool]$saved.autoCheck } } catch { }
    }
    return $defaults
}

function Save-Settings($Values) {
    [IO.File]::WriteAllText($script:SettingsFile, ($Values | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
}

# Адрес базы собирается из пароля: пользователь, сервер, порт и имя базы берутся из текущих настроек или по умолчанию.
function ConvertFrom-DbUrl([string]$Url) {
    $info = @{ User = "postgres"; Server = "localhost"; Port = 5432; Db = "formnow" }
    if ($Url) {
        try {
            $uri = [Uri]$Url
            if ($uri.Host) { $info.Server = $uri.Host }
            if ($uri.Port -gt 0) { $info.Port = $uri.Port }
            if ($uri.UserInfo) { $info.User = [Uri]::UnescapeDataString($uri.UserInfo.Split(":")[0]) }
            $name = $uri.AbsolutePath.Trim("/")
            if ($name) { $info.Db = [Uri]::UnescapeDataString($name) }
        }
        catch { }
    }
    return $info
}

function Build-DbUrl($Info, [string]$Password) {
    return "postgresql://{0}:{1}@{2}:{3}/{4}?sslmode=disable" -f [Uri]::EscapeDataString($Info.User), [Uri]::EscapeDataString($Password), $Info.Server, $Info.Port, [Uri]::EscapeDataString($Info.Db)
}

function ConvertTo-Arg([string]$Value) { return '"' + ($Value -replace '"', '\"') + '"' }

# ---------------------------------------------------------------- главное окно
$form = New-Object Windows.Forms.Form
$form.AutoScaleMode = "None"  # масштаб экрана пересчитывается явно (Form.Scale перед показом)
$form.Text = "Лаборатория 3Д - сервер"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object Drawing.Size(1120, 740)
$form.MinimumSize = New-Object Drawing.Size(1000, 680)
$form.BackColor = $ColBg
$form.ForeColor = $ColInk
$form.Font = New-Font 10
$exe = Join-Path $script:Root "Lab3D.exe"
if (Test-Path $exe) { try { $form.Icon = [Drawing.Icon]::ExtractAssociatedIcon($exe) } catch { } }

$sidebar = New-Object Windows.Forms.Panel
$sidebar.BackColor = $ColSide
$sidebar.Dock = "Left"
$sidebar.Width = 236
$content = New-Object Windows.Forms.Panel
$content.BackColor = $ColBg
$content.Dock = "Fill"
$content.Padding = New-Object Windows.Forms.Padding(34, 26, 34, 26)
$form.Controls.Add($content)
$form.Controls.Add($sidebar)

# бренд
$logo = New-Object Windows.Forms.PictureBox
$logo.SetBounds(22, 24, 40, 40)
$logo.SizeMode = "Zoom"
$logo.BackColor = $ColSide
$icoPath = Join-Path $PSScriptRoot "app.ico"
if (Test-Path $icoPath) {
    try {
        $icoBytes = [IO.File]::ReadAllBytes($icoPath)
        $frameCount = [BitConverter]::ToUInt16($icoBytes, 4)
        for ($i = 0; $i -lt $frameCount; $i++) {
            $entry = 6 + 16 * $i
            if ($icoBytes[$entry] -eq 64) {
                $size = [BitConverter]::ToUInt32($icoBytes, $entry + 8)
                $offset = [BitConverter]::ToUInt32($icoBytes, $entry + 12)
                $png = New-Object byte[] $size
                [Array]::Copy($icoBytes, $offset, $png, 0, $size)
                $logo.Image = [Drawing.Image]::FromStream((New-Object IO.MemoryStream(, $png)))
                break
            }
        }
    }
    catch { }
}
$brand = New-Label "Лаборатория 3Д" 13 $ColInk $true $ColSide
$brand.Location = New-Object Drawing.Point(72, 24)
$brandSub = New-Label "панель сервера" 9 $ColMuted $false $ColSide
$brandSub.Location = New-Object Drawing.Point(73, 50)
$sidebar.Controls.AddRange(@($logo, $brand, $brandSub))

$script:Pages = @{}
$script:NavButtons = @{}
$navItems = @(
    @("overview", "Обзор", (G 0xE80F)), @("orders", "Заказы", (G 0xE7BF)), @("printers", "Принтеры", (G 0xE749)),
    @("logs", "Логи", (G 0xE8FD)), @("updates", "Обновления", (G 0xE895)),
    @("settings", "Настройки", (G 0xE713)), @("panel", "Веб-панель", (G 0xE774)), @("cleanup", "Очистка", (G 0xE74D))
)
$navY = 108
foreach ($item in $navItems) {
    $nav = New-Object Lab3D.RoundButton
    $nav.Text = $item[1]
    $nav.Glyph = $item[2]
    $nav.Tag = $item[0]
    $nav.NavMode = $true
    $nav.Radius = 11
    $nav.SetBounds(14, $navY, 208, 46)
    $nav.Font = New-Font 10.5
    $nav.Ink = $ColMuted
    $nav.HoverFill = New-Color 26 26 31
    $nav.PressFill = New-Color 20 20 24
    $nav.ActiveFill = $ColCard
    $nav.ActiveInk = $ColAccent
    $nav.ActiveEdge = $ColLine
    $nav.Bar = $ColAccent
    $nav.OffInk = $ColMuted
    $nav.OffFill = $ColSide
    $nav.Add_Click({ Show-Page ([string]$this.Tag) })
    $sidebar.Controls.Add($nav)
    $script:NavButtons[$item[0]] = $nav
    $navY += 52
}
$versionLabel = New-Label "" 9 $ColMuted $false $ColSide
$versionLabel.Location = New-Object Drawing.Point(24, 660)
$sidebar.Controls.Add($versionLabel)
$sidebar.Add_Resize({ $versionLabel.Top = $sidebar.Height - (Px 52) })

function Show-Page([string]$Name) {
    foreach ($key in $script:Pages.Keys) { $script:Pages[$key].Visible = ($key -eq $Name) }
    foreach ($key in $script:NavButtons.Keys) { $script:NavButtons[$key].SetActive(($key -eq $Name)) }
    $script:CurrentPage = $Name
    if ($Name -eq "logs") { Reset-LogView }
    if ($Name -eq "updates") { Update-UpdatesView }
    if ($Name -eq "settings") { Load-SettingsValues }
    if ($Name -eq "printers") { $script:BbPollTick = 0; Update-BambuddyStatus }
    if ($Name -eq "panel") { Update-PanelStatus }
}

function Add-Page([string]$Name, $Control) {
    $Control.Dock = "Fill"
    $Control.Visible = $false
    $content.Controls.Add($Control)
    $script:Pages[$Name] = $Control
}

function New-Heading([string]$Title, [string]$Subtitle) {
    $panel = New-Object Windows.Forms.Panel
    $panel.Dock = "Fill"
    $panel.BackColor = $ColBg
    $t = New-Label $Title 21 $ColInk $true $ColBg
    $t.Location = New-Object Drawing.Point(0, 0)
    $s = New-Label $Subtitle 10 $ColMuted $false $ColBg
    $s.Location = New-Object Drawing.Point(2, 44)
    $panel.Controls.AddRange(@($t, $s))
    return $panel
}

# ---------------------------------------------------------------- страница: обзор
$pOverview = New-Table @(80, 184, 120, "auto", 40, "*")
$pOverview.Controls.Add((New-Heading "Обзор" "Состояние сайта и быстрые действия"), 0, 0)

$cardHero = New-Card $ColCard 18
$cardHero.Dock = "Fill"
$cardHero.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$dot = New-Object Lab3D.StatusDot
$dot.SetBounds(24, 24, 34, 34)
$lblState = New-Label "..." 22 $ColInk $true
$lblState.Location = New-Object Drawing.Point(64, 20)
$lblUptime = New-Label "" 10 $ColMuted
$lblUptime.Location = New-Object Drawing.Point(66, 66)
$cardHero.Controls.AddRange(@($dot, $lblState, $lblUptime))

$actions = New-Object Windows.Forms.FlowLayoutPanel
$actions.Dock = "Bottom"
$actions.Height = 74
$actions.BackColor = [Drawing.Color]::Transparent
$actions.Padding = New-Object Windows.Forms.Padding(22, 6, 0, 18)
$btnStart = New-Button "Запустить" "primary" 156 (G 0xE768)
$btnStop = New-Button "Остановить" "secondary" 158 (G 0xE71A)
$btnRestart = New-Button "Перезапустить" "secondary" 176 (G 0xE72C)
$btnOpen = New-Button "Открыть сайт" "secondary" 166 (G 0xE774)
$actions.Controls.AddRange(@($btnStart, $btnStop, $btnRestart, $btnOpen))
$cardHero.Controls.Add($actions)
$btnLocal = New-LocalButton $cardHero
$cardHero.Add_Resize({ $btnLocal.Left = $cardHero.Width - $btnLocal.Width - (Px 16) })
$pOverview.Controls.Add($cardHero, 0, 1)

# плитки: адрес / процессы / автозапуск / диск
$tiles = New-Table @(100) 4
$tiles.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$script:FieldValues = @{}
$col = 0
foreach ($name in @("Адрес", "Процессы", "Автозапуск", "Диск")) {
    $tile = New-Card $ColCard 14
    $tile.Dock = "Fill"
    $tile.Padding = New-Object Windows.Forms.Padding(18, 16, 12, 8)
    $tile.Margin = New-Object Windows.Forms.Padding(0, 0, $(if ($col -lt 3) { 14 } else { 0 }), 0)
    if ($name -eq "Адрес") {
        $v = New-Object Windows.Forms.LinkLabel
        $v.LinkColor = $ColBlue
        $v.ActiveLinkColor = $ColAccent
        $v.VisitedLinkColor = $ColBlue
        $v.LinkBehavior = "HoverUnderline"
        $v.Add_LinkClicked({ if ($script:SiteUrl) { Start-Process $script:SiteUrl } })
    }
    else { $v = New-Object Windows.Forms.Label; $v.ForeColor = $ColInk }
    $v.AutoSize = $false
    $v.AutoEllipsis = $true
    $v.Dock = "Top"
    $v.Height = 34
    $v.BackColor = $ColCard
    $v.Font = New-Font 12 $true
    $v.Text = "-"
    $k = New-Label $name 9 $ColMuted $false $ColCard
    $k.AutoSize = $false
    $k.Dock = "Top"
    $k.Height = 22
    $tile.Controls.Add($v)
    $tile.Controls.Add($k)
    $tiles.Controls.Add($tile, $col, 0)
    $script:FieldValues[$name] = $v
    $col++
}
$pOverview.Controls.Add($tiles, 0, 2)

$bannerUpdate = New-Card (New-Color 19 38 23) 14
$bannerUpdate.Edge = New-Color 58 108 64
$bannerUpdate.Dock = "Fill"
$bannerUpdate.Height = 60
$bannerUpdate.Visible = $false
$bannerUpdate.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$lblBanner = New-Label "" 10.5 $ColAccent $true (New-Color 19 38 23)
$lblBanner.Location = New-Object Drawing.Point(20, 19)
$btnBanner = New-Button "Обновить" "primary" 140 (G 0xE896)
$btnBanner.Height = 38
$btnBanner.Anchor = "Top,Right"
$btnBanner.Location = New-Object Drawing.Point(($bannerUpdate.Width - 160), 11)
$bannerUpdate.Add_Resize({ $btnBanner.Left = $bannerUpdate.Width - $btnBanner.Width - (Px 16) })
$bannerUpdate.Controls.AddRange(@($lblBanner, $btnBanner))
$pOverview.Controls.Add($bannerUpdate, 0, 3)

$journalHead = New-Object Windows.Forms.Panel
$journalHead.Dock = "Fill"
$journalHead.BackColor = $ColBg
$consoleTitle = New-Label "Журнал действий" 10 $ColMuted $false $ColBg
$consoleTitle.Location = New-Object Drawing.Point(2, 10)
$btnClearJournal = New-Button "Очистить" "ghost" 110 (G 0xE74D)
$btnClearJournal.Height = 30
$btnClearJournal.Anchor = "Top,Right"
$btnClearJournal.Location = New-Object Drawing.Point(($journalHead.Width - 100), 4)
$journalHead.Add_Resize({ $btnClearJournal.Left = $journalHead.Width - $btnClearJournal.Width })
$journalHead.Controls.AddRange(@($consoleTitle, $btnClearJournal))
$pOverview.Controls.Add($journalHead, 0, 4)
$console = New-Console
$pOverview.Controls.Add((New-ConsoleCard $console), 0, 5)
Add-Page "overview" $pOverview

# ---------------------------------------------------------------- страница: заказы (lab)
$pOrders = New-Table @(80, 184, 120, 40, "*")
$pOrders.Controls.Add((New-Heading "Заказы" "Приём и сборка заказов (lab) - состояние и быстрые действия"), 0, 0)

$cardOrdersHero = New-Card $ColCard 18
$cardOrdersHero.Dock = "Fill"
$cardOrdersHero.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$dotOrders = New-Object Lab3D.StatusDot
$dotOrders.SetBounds(24, 24, 34, 34)
$lblOrdersState = New-Label "..." 22 $ColInk $true
$lblOrdersState.Location = New-Object Drawing.Point(64, 20)
$lblOrdersUptime = New-Label "" 10 $ColMuted
$lblOrdersUptime.Location = New-Object Drawing.Point(66, 66)
$cardOrdersHero.Controls.AddRange(@($dotOrders, $lblOrdersState, $lblOrdersUptime))

$actionsOrders = New-Object Windows.Forms.FlowLayoutPanel
$actionsOrders.Dock = "Bottom"
$actionsOrders.Height = 74
$actionsOrders.BackColor = [Drawing.Color]::Transparent
$actionsOrders.Padding = New-Object Windows.Forms.Padding(22, 6, 0, 18)
$btnOrdersStart = New-Button "Запустить" "primary" 156 (G 0xE768)
$btnOrdersStop = New-Button "Остановить" "secondary" 158 (G 0xE71A)
$btnOrdersRestart = New-Button "Перезапустить" "secondary" 176 (G 0xE72C)
$btnOrdersOpen = New-Button "Открыть сайт" "secondary" 166 (G 0xE774)
$actionsOrders.Controls.AddRange(@($btnOrdersStart, $btnOrdersStop, $btnOrdersRestart, $btnOrdersOpen))
$cardOrdersHero.Controls.Add($actionsOrders)
$btnOrdersLocal = New-LocalButton $cardOrdersHero
$cardOrdersHero.Add_Resize({ $btnOrdersLocal.Left = $cardOrdersHero.Width - $btnOrdersLocal.Width - (Px 16) })
$pOrders.Controls.Add($cardOrdersHero, 0, 1)

# плитки: адрес / процесс / автозапуск / диск
$tilesOrders = New-Table @(100) 4
$tilesOrders.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$script:OrdersFieldValues = @{}
$col = 0
foreach ($name in @("Адрес", "Процесс", "Автозапуск", "Диск")) {
    $tile = New-Card $ColCard 14
    $tile.Dock = "Fill"
    $tile.Padding = New-Object Windows.Forms.Padding(18, 16, 12, 8)
    $tile.Margin = New-Object Windows.Forms.Padding(0, 0, $(if ($col -lt 3) { 14 } else { 0 }), 0)
    if ($name -eq "Адрес") {
        $v = New-Object Windows.Forms.LinkLabel
        $v.LinkColor = $ColBlue
        $v.ActiveLinkColor = $ColAccent
        $v.VisitedLinkColor = $ColBlue
        $v.LinkBehavior = "HoverUnderline"
        $v.Add_LinkClicked({ if ($script:LabSiteUrl) { Start-Process $script:LabSiteUrl } })
    }
    else { $v = New-Object Windows.Forms.Label; $v.ForeColor = $ColInk }
    $v.AutoSize = $false
    $v.AutoEllipsis = $true
    $v.Dock = "Top"
    $v.Height = 34
    $v.BackColor = $ColCard
    $v.Font = New-Font 12 $true
    $v.Text = "-"
    $k = New-Label $name 9 $ColMuted $false $ColCard
    $k.AutoSize = $false
    $k.Dock = "Top"
    $k.Height = 22
    $tile.Controls.Add($v)
    $tile.Controls.Add($k)
    $tilesOrders.Controls.Add($tile, $col, 0)
    $script:OrdersFieldValues[$name] = $v
    $col++
}
$pOrders.Controls.Add($tilesOrders, 0, 2)

$journalHeadOrders = New-Object Windows.Forms.Panel
$journalHeadOrders.Dock = "Fill"
$journalHeadOrders.BackColor = $ColBg
$consoleTitleOrders = New-Label "Журнал действий" 10 $ColMuted $false $ColBg
$consoleTitleOrders.Location = New-Object Drawing.Point(2, 10)
$btnOrdersClearJournal = New-Button "Очистить" "ghost" 110 (G 0xE74D)
$btnOrdersClearJournal.Height = 30
$btnOrdersClearJournal.Anchor = "Top,Right"
$btnOrdersClearJournal.Location = New-Object Drawing.Point(($journalHeadOrders.Width - 100), 4)
$journalHeadOrders.Add_Resize({ $btnOrdersClearJournal.Left = $journalHeadOrders.Width - $btnOrdersClearJournal.Width })
$journalHeadOrders.Controls.AddRange(@($consoleTitleOrders, $btnOrdersClearJournal))
$pOrders.Controls.Add($journalHeadOrders, 0, 3)
$consoleOrders = New-Console
$pOrders.Controls.Add((New-ConsoleCard $consoleOrders), 0, 4)
Add-Page "orders" $pOrders

# ---------------------------------------------------------------- страница: принтеры (Bambuddy)
$pPrinters = New-Table @(80, 184, 120, 70, "*")
$pPrinters.Controls.Add((New-Heading "Принтеры" "Bambuddy - служба управления принтерами Bambu Lab"), 0, 0)

$cardBbHero = New-Card $ColCard 18
$cardBbHero.Dock = "Fill"
$cardBbHero.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$dotBb = New-Object Lab3D.StatusDot
$dotBb.SetBounds(24, 24, 34, 34)
$lblBbState = New-Label "..." 22 $ColInk $true
$lblBbState.Location = New-Object Drawing.Point(64, 20)
$lblBbSub = New-Label "" 10 $ColMuted
$lblBbSub.Location = New-Object Drawing.Point(66, 66)
$cardBbHero.Controls.AddRange(@($dotBb, $lblBbState, $lblBbSub))

$actionsBb = New-Object Windows.Forms.FlowLayoutPanel
$actionsBb.Dock = "Bottom"
$actionsBb.Height = 74
$actionsBb.BackColor = [Drawing.Color]::Transparent
$actionsBb.Padding = New-Object Windows.Forms.Padding(22, 6, 0, 18)
$btnBbStart = New-Button "Запустить" "primary" 156 (G 0xE768)
$btnBbStop = New-Button "Остановить" "secondary" 158 (G 0xE71A)
$btnBbRestart = New-Button "Перезапустить" "secondary" 176 (G 0xE72C)
$btnBbOpen = New-Button "Открыть" "secondary" 150 (G 0xE774)
$actionsBb.Controls.AddRange(@($btnBbStart, $btnBbStop, $btnBbRestart, $btnBbOpen))
$cardBbHero.Controls.Add($actionsBb)
# логи Bambuddy пишет сам (C:\ProgramData\Bambuddy\logs) - кнопка просто открывает папку
$btnBbLogs = New-Button "Логи" "ghost" 104 (G 0xE8FD)
$btnBbLogs.Height = 32
$btnBbLogs.Anchor = "Top,Right"
$btnBbLogs.Location = New-Object Drawing.Point(($cardBbHero.Width - 120), 16)
$cardBbHero.Controls.Add($btnBbLogs)
$btnBbLocal = New-LocalButton $cardBbHero
$cardBbHero.Add_Resize({
    $btnBbLogs.Left = $cardBbHero.Width - $btnBbLogs.Width - (Px 16)
    $btnBbLocal.Left = $btnBbLogs.Left - $btnBbLocal.Width - (Px 6)
})
$pPrinters.Controls.Add($cardBbHero, 0, 1)

# плитки: адрес / поддомен / принтеры / ключ API
$tilesBb = New-Table @(100) 4
$tilesBb.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$script:BbFieldValues = @{}
$col = 0
foreach ($name in @("Адрес", "Поддомен", "Принтеры", "Ключ API")) {
    $tile = New-Card $ColCard 14
    $tile.Dock = "Fill"
    $tile.Padding = New-Object Windows.Forms.Padding(18, 16, 12, 8)
    $tile.Margin = New-Object Windows.Forms.Padding(0, 0, $(if ($col -lt 3) { 14 } else { 0 }), 0)
    if ($name -eq "Адрес") {
        $v = New-Object Windows.Forms.LinkLabel
        $v.LinkColor = $ColBlue
        $v.ActiveLinkColor = $ColAccent
        $v.VisitedLinkColor = $ColBlue
        $v.LinkBehavior = "HoverUnderline"
        $v.Add_LinkClicked({ if ($script:BbUrl) { Start-Process $script:BbUrl } })
    }
    else { $v = New-Object Windows.Forms.Label; $v.ForeColor = $ColInk }
    $v.AutoSize = $false
    $v.AutoEllipsis = $true
    $v.Dock = "Top"
    $v.Height = 34
    $v.BackColor = $ColCard
    $v.Font = New-Font 12 $true
    $v.Text = "-"
    $k = New-Label $name 9 $ColMuted $false $ColCard
    $k.AutoSize = $false
    $k.Dock = "Top"
    $k.Height = 22
    $tile.Controls.Add($v)
    $tile.Controls.Add($k)
    $tilesBb.Controls.Add($tile, $col, 0)
    $script:BbFieldValues[$name] = $v
    $col++
}
$pPrinters.Controls.Add($tilesBb, 0, 2)

# ключ API (для страницы «Принтеры» в админке сайта) и подключение поддомена
$bbKeyBar = New-Object Windows.Forms.FlowLayoutPanel
$bbKeyBar.Dock = "Fill"
$bbKeyBar.BackColor = $ColBg
$bbKeyBar.WrapContents = $false
$lblBbKey = New-Label "Ключ API" 10 $ColMuted $false $ColBg
$lblBbKey.Margin = New-Object Windows.Forms.Padding(2, 20, 12, 0)
$inBbKey = New-Input "" $true "Bambuddy → Settings → API Keys"
$inBbKey.Dock = "None"
$inBbKey.Width = 270
$inBbKey.Height = 38
$inBbKey.Margin = New-Object Windows.Forms.Padding(0, 10, 10, 0)
$btnBbKey = New-Button "Сохранить" "secondary" 140 (G 0xE74E)
$btnBbKey.Margin = New-Object Windows.Forms.Padding(0, 8, 10, 0)
$btnBbSite = New-Button "Подключить поддомен" "secondary" 210 (G 0xE71B)
$btnBbSite.Margin = New-Object Windows.Forms.Padding(0, 8, 0, 0)
$bbKeyBar.Controls.AddRange(@($lblBbKey, $inBbKey, $btnBbKey, $btnBbSite))
$pPrinters.Controls.Add($bbKeyBar, 0, 3)

# слева - принтеры (живой статус из API Bambuddy), справа - журнал действий этой вкладки
$bbBottom = New-Table @("*") 2
$bbBottom.ColumnStyles.Clear()
[void]$bbBottom.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", 58)))
[void]$bbBottom.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", 42)))
$printerView = New-Console
$printerView.Font = New-Object Drawing.Font("Segoe UI", (10 * $script:FontBoost))
$printerCard = New-ConsoleCard $printerView
$printerCard.Margin = New-Object Windows.Forms.Padding(0, 0, 14, 0)
$bbBottom.Controls.Add($printerCard, 0, 0)
$consoleBb = New-Console
$bbJournal = New-ConsoleCard $consoleBb
$bbJournal.Margin = New-Object Windows.Forms.Padding(0)
$bbBottom.Controls.Add($bbJournal, 1, 0)
$pPrinters.Controls.Add($bbBottom, 0, 4)
Add-Page "printers" $pPrinters

# ---------------------------------------------------------------- страница: логи
$pLogs = New-Table @(80, 52, "*")
$pLogs.Controls.Add((New-Heading "Логи" "Живой вывод сайта, ошибок, HTTPS и событий сервера"), 0, 0)
$logBar = New-Object Windows.Forms.FlowLayoutPanel
$logBar.Dock = "Fill"
$logBar.BackColor = $ColBg
# Значения - полные пути (не просто имена файлов): у "Заказы: ..." лог-каталог другой (lab/deploy/logs).
$logSources = [ordered]@{
    "Сайт" = (Join-Path $script:LogDir "next.log"); "Ошибки сайта" = (Join-Path $script:LogDir "next-error.log")
    "HTTPS (Caddy)" = (Join-Path $script:LogDir "caddy-error.log"); "События сервера" = (Join-Path $script:LogDir "supervisor.log")
    "Журнал операций" = (Join-Path $script:LogDir "gui-task-out.log")
    "Заказы: сервер" = (Join-Path $script:LabLogDir "app.log"); "Заказы: ошибки" = (Join-Path $script:LabLogDir "app-error.log")
}
$script:LogChips = @{}
$script:LogKey = "Сайт"
foreach ($key in $logSources.Keys) {
    $chip = New-Object Lab3D.RoundButton
    $chip.Text = $key
    $chip.Tag = $key
    $chip.Radius = 17
    $chip.Height = 36
    $chip.Width = 30 + $key.Length * 9
    $chip.Font = New-Font 9.5
    $chip.Margin = New-Object Windows.Forms.Padding(0, 0, 10, 0)
    $chip.Fill = $ColField; $chip.HoverFill = New-Color 40 40 47; $chip.PressFill = $ColLine; $chip.Edge = $ColLine; $chip.Ink = $ColMuted
    $chip.ActiveFill = New-Color 22 42 26; $chip.ActiveInk = $ColAccent; $chip.ActiveEdge = New-Color 64 118 70
    $chip.Add_Click({ Set-LogSource ([string]$this.Tag) })
    $logBar.Controls.Add($chip)
    $script:LogChips[$key] = $chip
}
$pLogs.Controls.Add($logBar, 0, 1)
$logView = New-Console
$pLogs.Controls.Add((New-ConsoleCard $logView), 0, 2)
Add-Page "logs" $pLogs
$script:LogPos = 0

function Reset-LogView {
    foreach ($key in $script:LogChips.Keys) { $script:LogChips[$key].SetActive(($key -eq $script:LogKey)) }
    $logView.Clear()
    $script:LogPos = 0
    $path = $logSources[$script:LogKey]
    if (Test-Path $path) {
        $length = (Get-Item $path).Length
        if ($length -gt 12000) { $script:LogPos = $length - 12000 }
    }
    else { Add-ConsoleText $logView "Лог пока пуст.`n" $ColMuted }
}

function Set-LogSource([string]$Key) {
    $script:LogKey = $Key
    Reset-LogView
}

# ---------------------------------------------------------------- страница: обновления
$pUpdates = New-Table @(80, 224, 34, "*", 70)
$pUpdates.Controls.Add((New-Heading "Обновления" "Код сайта берётся из git-репозитория"), 0, 0)

$cardVersion = New-Card $ColCard 16
$cardVersion.Dock = "Fill"
$cardVersion.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 14)
$script:UpdateValues = @{}
$uy = 20
foreach ($name in @("Версия", "Ветка", "Репозиторий", "Статус")) {
    $k = New-Label $name 10 $ColMuted
    $k.Location = New-Object Drawing.Point(26, $uy)
    $v = New-Label "-" 10 $ColInk
    $v.Location = New-Object Drawing.Point(160, $uy)
    $cardVersion.Controls.AddRange(@($k, $v))
    $script:UpdateValues[$name] = $v
    $uy += 34
}
$chkAuto = New-Toggle "Проверять обновления автоматически (раз в 30 минут)" 560
$chkAuto.Location = New-Object Drawing.Point(24, 170)
$chkAuto.Checked = [bool](Get-Settings).autoCheck
$chkAuto.Add_CheckedChanged({ Save-Settings ([ordered]@{ autoCheck = [bool]$chkAuto.Checked }) })
$cardVersion.Controls.Add($chkAuto)
$pUpdates.Controls.Add($cardVersion, 0, 1)

$lblCommits = New-Label "Что изменится после обновления" 10 $ColMuted $false $ColBg
$lblCommits.Margin = New-Object Windows.Forms.Padding(2, 6, 0, 0)
$pUpdates.Controls.Add($lblCommits, 0, 2)

$commitList = New-Object Windows.Forms.ListBox
$commitList.Dock = "Fill"
$commitList.BackColor = $ColConsole
$commitList.ForeColor = $ColInk
$commitList.BorderStyle = "None"
$commitList.Font = New-Object Drawing.Font("Consolas", (10 * $script:FontBoost))
$commitList.Add_HandleCreated({ Set-DarkScroll $this })
$cardCommits = New-Card $ColConsole 12
$cardCommits.Dock = "Fill"
$cardCommits.Padding = New-Object Windows.Forms.Padding(14, 12, 8, 12)
$cardCommits.Controls.Add($commitList)
$pUpdates.Controls.Add($cardCommits, 0, 3)

$updBar = New-Object Windows.Forms.FlowLayoutPanel
$updBar.Dock = "Fill"
$updBar.BackColor = $ColBg
$updBar.Padding = New-Object Windows.Forms.Padding(0, 16, 0, 0)
$btnCheck = New-Button "Проверить сейчас" "secondary" 200 (G 0xE895)
$btnUpdate = New-Button "Обновить и перезапустить" "primary" 280 (G 0xE896)
$lblUpdHint = New-Label "" 9.5 $ColMuted $false $ColBg
$lblUpdHint.Margin = New-Object Windows.Forms.Padding(6, 12, 0, 0)
$updBar.Controls.AddRange(@($btnCheck, $btnUpdate, $lblUpdHint))
$pUpdates.Controls.Add($updBar, 0, 4)

# Если папка не подключена к git (или подключена не до конца) - вместо версии показываем форму подключения.
$cardConnect = New-Card $ColCard 16
$cardConnect.Dock = "Fill"
$cardConnect.Visible = $false
$cardConnect.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 14)
$cLbl = New-Label "Папка не подключена к git. Укажите репозиторий, из которого сайт будет обновляться." 10 $ColYellow
$cLbl.Location = New-Object Drawing.Point(26, 20)
$cUrlLbl = New-Label "Адрес репозитория" 10 $ColMuted
$cUrlLbl.Location = New-Object Drawing.Point(26, 68)
$inUrl = New-Input "https://github.com/ВАШ_АККАУНТ/ВАШ_РЕПОЗИТОРИЙ.git"
$inUrl.Dock = "None"
$inUrl.SetBounds(200, 60, 560, 38)
$cBranchLbl = New-Label "Ветка" 10 $ColMuted
$cBranchLbl.Location = New-Object Drawing.Point(26, 118)
$inBranch = New-Input "" $false "auto - ветка по умолчанию"
$inBranch.Dock = "None"
$inBranch.SetBounds(200, 110, 240, 38)
$btnConnect = New-Button "Подключить" "primary" 170 (G 0xE71B)
$btnConnect.Location = New-Object Drawing.Point(200, 164)
$cardConnect.Controls.AddRange(@($cLbl, $cUrlLbl, $inUrl, $cBranchLbl, $inBranch, $btnConnect))
$pUpdates.Controls.Add($cardConnect, 0, 1)
Add-Page "updates" $pUpdates

# ---------------------------------------------------------------- страница: настройки
$pSettings = New-Table @(80, "auto", "auto", "*")
$pSettings.Controls.Add((New-Heading "Настройки" "Установка, домен, база данных и автозапуск"), 0, 0)

$cardSet = New-Card $ColCard 18
$cardSet.Dock = "Top"
$cardSet.Height = 416
$cardSet.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$grid = New-Table @(58, 58, 44, "auto", 58, 58, 50, 46) 2
$grid.Dock = "Fill"
$grid.BackColor = [Drawing.Color]::Transparent
$grid.Padding = New-Object Windows.Forms.Padding(26, 14, 26, 8)
$grid.ColumnStyles.Clear()
[void]$grid.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Absolute", 200)))
[void]$grid.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", 100)))
$inDomain = New-Input "" $false "например lab-3d.pro (пусто - работать по IP)"
$inDbPass = New-Input "" $true "пароль пользователя postgres"
$inDbUrl = New-Input "" $true "postgresql://пользователь:пароль@сервер:5432/база"
$inAdmin = New-Input "admin"
$inPass = New-Input "" $true "пусто - случайный пароль (или оставить прежний)"
$chkAutostart = New-Toggle "Запускать сайт вместе с Windows" 420
$chkAutostart.Anchor = "Left"

$lblDbHint = New-Label "" 9 $ColMuted $false ([Drawing.Color]::Transparent)
$lblDbHint.Margin = New-Object Windows.Forms.Padding(2, 11, 8, 0)
$btnDbAdvanced = New-Button "Другой адрес базы..." "ghost" 200
$btnDbAdvanced.Height = 32
$btnDbAdvanced.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 0)
$dbHintRow = New-Object Windows.Forms.FlowLayoutPanel
$dbHintRow.BackColor = [Drawing.Color]::Transparent
$dbHintRow.Dock = "Fill"
$dbHintRow.WrapContents = $false
$dbHintRow.Controls.AddRange(@($lblDbHint, $btnDbAdvanced))
$lblDbUrl = New-Label "Полный адрес" 10 $ColMuted
$lblDbUrl.Anchor = "Left"
$lblDbUrl.Visible = $false
$inDbUrl.Visible = $false

$labelDomain = New-Label "Домен" 10 $ColMuted; $labelDomain.Anchor = "Left"
$labelDbPass = New-Label "Пароль PostgreSQL" 10 $ColMuted; $labelDbPass.Anchor = "Left"
$labelAdmin = New-Label "Логин админа" 10 $ColMuted; $labelAdmin.Anchor = "Left"
$labelAdminPass = New-Label "Пароль админа" 10 $ColMuted; $labelAdminPass.Anchor = "Left"
$grid.Controls.Add($labelDomain, 0, 0);    $grid.Controls.Add($inDomain, 1, 0)
$grid.Controls.Add($labelDbPass, 0, 1);    $grid.Controls.Add($inDbPass, 1, 1)
$grid.Controls.Add($dbHintRow, 1, 2)
$grid.Controls.Add($lblDbUrl, 0, 3);       $grid.Controls.Add($inDbUrl, 1, 3)
$grid.Controls.Add($labelAdmin, 0, 4);     $grid.Controls.Add($inAdmin, 1, 4)
$grid.Controls.Add($labelAdminPass, 0, 5); $grid.Controls.Add($inPass, 1, 5)
$grid.Controls.Add($chkAutostart, 1, 6)
$hint = New-Label "Домен: A-запись на IP сервера, порты 80 и 443 открыты. Пароль админа - не короче 8 символов." 9 $ColMuted
$hint.Anchor = "Left"
$grid.Controls.Add($hint, 1, 7)
$btnDbAdvanced.Add_Click({
    $show = -not $inDbUrl.Visible
    $inDbUrl.Visible = $show
    $lblDbUrl.Visible = $show
    $cardSet.Height = $(if ($show) { Px 476 } else { Px 416 })
})
$cardSet.Controls.Add($grid)
$pSettings.Controls.Add($cardSet, 0, 1)

$setBar = New-Object Windows.Forms.FlowLayoutPanel
$setBar.Dock = "Fill"
$setBar.BackColor = $ColBg
$setBar.Height = 60
$btnApply = New-Button "Применить и установить" "primary" 260 (G 0xE73E)
$btnUninstall = New-Button "Удалить установку..." "danger" 230 (G 0xE74D)
$setBar.Controls.AddRange(@($btnApply, $btnUninstall))
$pSettings.Controls.Add($setBar, 0, 2)
Add-Page "settings" $pSettings

function Load-SettingsValues {
    $config = Read-EnvFile $script:EnvFile
    $inDomain.Text = $config["DEPLOY_DOMAIN"]
    $dbInfo = ConvertFrom-DbUrl $config["DATABASE_URL"]
    $lblDbHint.Text = "Подключение: {0}@{1}:{2}, база {3}" -f $dbInfo.User, $dbInfo.Server, $dbInfo.Port, $dbInfo.Db
    $inDbPass.Text = ""
    $inDbPass.Cue = $(if ($config["DATABASE_URL"]) { "пусто - оставить прежний пароль" } else { "пароль пользователя postgres" })
    $inDbUrl.Text = ""
    $chkAutostart.Checked = [bool](Get-AutostartTask)
    $btnApply.Text = $(if ($config.Count -gt 0) { "Применить" } else { "Установить" })
    $btnUninstall.Enabled = ($config.Count -gt 0)
}

# ---------------------------------------------------------------- страница: веб-панель
# То же управление в браузере на panel.<домен> (deploy/panel.mjs): статус, перезапуск, обновление,
# логи. Журнал и блокировка операций общие с этим окном.
$pPanel = New-Table @(80, 330, "*")
$pPanel.Controls.Add((New-Heading "Веб-панель" "Управление сервером из браузера - с телефона или другого компьютера"), 0, 0)

$cardPanel = New-Card $ColCard 16
$cardPanel.Dock = "Fill"
$cardPanel.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$pt = New-Label "Состояние" 10 $ColMuted
$pt.Location = New-Object Drawing.Point(26, 22)
$lblPanelState = New-Label "..." 12 $ColInk $true
$lblPanelState.Location = New-Object Drawing.Point(150, 20)
$pa = New-Label "Адрес" 10 $ColMuted
$pa.Location = New-Object Drawing.Point(26, 62)
$lnkPanel = New-Object Windows.Forms.LinkLabel
$lnkPanel.AutoSize = $true
$lnkPanel.Font = New-Font 11
$lnkPanel.BackColor = $ColCard
$lnkPanel.LinkColor = $ColBlue; $lnkPanel.ActiveLinkColor = $ColAccent; $lnkPanel.VisitedLinkColor = $ColBlue
$lnkPanel.LinkBehavior = "HoverUnderline"
$lnkPanel.Location = New-Object Drawing.Point(150, 60)
$lnkPanel.Text = "-"
$lnkPanel.Add_LinkClicked({ if ($script:PanelUrl) { Start-Process $script:PanelUrl } })
$pp = New-Label "Новый пароль" 10 $ColMuted
$pp.Location = New-Object Drawing.Point(26, 112)
$inPanelPass = New-Input "" $true "не короче 10 символов (пусто - оставить прежний)"
$inPanelPass.Dock = "None"
$inPanelPass.SetBounds(150, 102, 420, 38)
$panelBar = New-Object Windows.Forms.FlowLayoutPanel
$panelBar.BackColor = [Drawing.Color]::Transparent
$panelBar.SetBounds(22, 158, 900, 50)
$btnPanelEnable = New-Button "Сохранить и включить" "primary" 250 (G 0xE73E)
$btnPanelOpen = New-Button "Открыть" "secondary" 150 (G 0xE774)
$btnPanelDisable = New-Button "Выключить" "danger" 160 (G 0xE711)
$panelBar.Controls.AddRange(@($btnPanelEnable, $btnPanelOpen, $btnPanelDisable))
$panelHint = New-Label ("Нужна DNS-запись A: panel.<домен> -> IP сервера (как у сайта).`n" +
    "В панели: статус сайта, CRM и Bambuddy, перезапуск, обновление из git, журнал и логи.`n" +
    "Пароль хранится только в виде хэша. 5 неверных попыток подряд блокируют вход на 15 минут.") 9 $ColMuted
$panelHint.Location = New-Object Drawing.Point(26, 222)
$cardPanel.Controls.AddRange(@($pt, $lblPanelState, $pa, $lnkPanel, $pp, $inPanelPass, $panelBar, $panelHint))
$pPanel.Controls.Add($cardPanel, 0, 1)
Add-Page "panel" $pPanel

$script:PanelUrl = ""
function Update-PanelStatus {
    $config = Read-EnvFile $script:EnvFile
    $port = if ($config["PANEL_PORT"]) { [int]$config["PANEL_PORT"] } else { 3100 }
    $task = Get-ScheduledTask -TaskName $script:PanelTaskName -ErrorAction SilentlyContinue
    $listening = [bool](Get-PortOwner $port)
    $domain = Get-PanelDomain $config["DEPLOY_DOMAIN"]
    $script:PanelUrl = if ($domain -and (Test-Path $script:PanelSiteFile)) { "https://$domain" } elseif ($listening) { "http://127.0.0.1:$port" } else { "" }
    if (-not $task) { $lblPanelState.Text = "выключена"; $lblPanelState.ForeColor = $ColMuted }
    elseif ($listening) { $lblPanelState.Text = "работает"; $lblPanelState.ForeColor = $ColAccent }
    else { $lblPanelState.Text = "включена, но не отвечает (перезапустится сама в течение минуты)"; $lblPanelState.ForeColor = $ColYellow }
    $lnkPanel.Text = $(if ($script:PanelUrl) { $script:PanelUrl } else { "-" })
    $free = -not $script:Busy -and -not $script:WebOp
    $btnPanelEnable.Enabled = $free -and ($config.Count -gt 0)
    $btnPanelEnable.Text = $(if ($task) { "Сохранить пароль" } else { "Сохранить и включить" })
    $btnPanelOpen.Enabled = [bool]$script:PanelUrl
    $btnPanelDisable.Enabled = $free -and [bool]$task
}

# ---------------------------------------------------------------- страница: очистка
$pCleanup = New-Table @(80, 168, 228, "*")
$pCleanup.Controls.Add((New-Heading "Очистка" "Удаление файлов, которые больше не нужны"), 0, 0)

$cardCache = New-Card $ColCard 16
$cardCache.Dock = "Fill"
$cardCache.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$t1 = New-Label "Кэш сборки и старые логи" 12 $ColInk $true
$t1.Location = New-Object Drawing.Point(26, 20)
$d1 = New-Label "Безопасно: всё пересоздаётся само при следующей сборке и работе сервера." 10 $ColMuted
$d1.Location = New-Object Drawing.Point(26, 54)
$btnCache = New-Button "Очистить" "secondary" 160 (G 0xE74D)
$btnCache.Location = New-Object Drawing.Point(26, 96)
$cardCache.Controls.AddRange(@($t1, $d1, $btnCache))
$pCleanup.Controls.Add($cardCache, 0, 1)

$cardUploads = New-Card $ColCard 16
$cardUploads.Dock = "Fill"
$cardUploads.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 16)
$t2 = New-Label "Неиспользуемые загрузки" 12 $ColInk $true
$t2.Location = New-Object Drawing.Point(26, 20)
$d2 = New-Label "Модели, которые загрузили для расчёта, но не заказали, и файлы без записи в базе." 10 $ColMuted
$d2.Location = New-Object Drawing.Point(26, 54)
$dl = New-Label "Старше (дней):" 10 $ColMuted
$dl.Location = New-Object Drawing.Point(26, 104)
$numDays = New-Input "30"
$numDays.Dock = "None"
$numDays.SetBounds(150, 94, 90, 38)
$numDays.Inner.Add_KeyPress({ if (-not [char]::IsDigit($_.KeyChar) -and -not [char]::IsControl($_.KeyChar)) { $_.Handled = $true } })
function Get-Days { $n = 30; if ([int]::TryParse($numDays.Text, [ref]$n) -and $n -ge 1) { return $n }; return 30 }
$btnScan = New-Button "Найти" "secondary" 140 (G 0xE721)
$btnScan.Location = New-Object Drawing.Point(262, 94)
$btnPurge = New-Button "Удалить найденное" "danger" 210 (G 0xE74D)
$btnPurge.Location = New-Object Drawing.Point(416, 94)
$btnPurge.Enabled = $false
$lblScan = New-Label "" 10 $ColInk
$lblScan.Location = New-Object Drawing.Point(26, 148)
$cardUploads.Controls.AddRange(@($t2, $d2, $dl, $numDays, $btnScan, $btnPurge, $lblScan))
$pCleanup.Controls.Add($cardUploads, 0, 2)
Add-Page "cleanup" $pCleanup


# ---------------------------------------------------------------- выполнение операций
$script:Queue = New-Object Collections.Queue
$script:Current = $null
$script:OnFinish = $null
$script:Busy = $false

# Свои строки - в общий журнал; позиция чтения сдвигается за них, чтобы не показать их второй раз.
function Write-OwnJournal([string]$Text) {
    Add-Journal $Text
    try { $script:JournalPos = (Get-Item $script:JournalFile).Length } catch { }
}

function Set-Busy([bool]$Value) {
    $script:Busy = $Value
    Update-Status
    Update-LabStatus
    Update-BambuddyStatus $false
}

function Add-Steps([object[]]$Steps, [scriptblock]$OnFinish = $null) {
    if ($script:Current) { return }
    # Веб-панель и это окно - одно целое: две операции одновременно не идут (тихие проверки - можно).
    $web = Get-WebOperation
    if ($web -and ($Steps | Where-Object { -not $_.Silent })) {
        [void][Windows.Forms.MessageBox]::Show(("Сейчас выполняется «{0}» из веб-панели. Дождитесь окончания - ход видно в журнале." -f $web.title), "Лаборатория 3Д", "OK", "Information")
        return
    }
    foreach ($step in $Steps) { $script:Queue.Enqueue($step) }
    $script:OnFinish = $OnFinish
    Set-Busy $true
    Start-NextStep
}

function Start-NextStep {
    if ($script:Queue.Count -eq 0) { Complete-Steps $true; return }
    $step = $script:Queue.Dequeue()
    if ($step.When -and -not (& $step.When)) { Start-NextStep; return }

    # Заказы (lab) задают свои Console/LogDir в New-LabServerStep, чтобы их журнал шёл на
    # свою вкладку, а не смешивался с журналом основного сайта; для обычных шагов - фолбэк.
    $stepConsole = if ($step.Console) { $step.Console } else { $console }
    $logDir = if ($step.LogDir) { $step.LogDir } else { $script:LogDir }
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $out = Join-Path $logDir "gui-task-out.log"
    $err = Join-Path $logDir "gui-task-err.log"
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    if (-not $step.Silent) {
        Add-ConsoleText $stepConsole ("`n► " + $step.Title + "`n") (New-Color 110 190 220)
        Write-OwnJournal ("`n► " + $step.Title + "`n")
        [IO.File]::WriteAllText($script:GuiLockFile, (@{ pid = $PID; title = $step.Title } | ConvertTo-Json -Compress))
    }
    $argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" {1}' -f $step.Script, $step.Args
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argLine -WorkingDirectory $script:Root -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err
    [void]$process.Handle
    $script:Current = @{ Step = $step; Process = $process; Out = $out; Err = $err; OutPos = 0; ErrPos = 0; Text = New-Object Text.StringBuilder }
}

function Complete-Steps([bool]$Ok) {
    Remove-Item $script:GuiLockFile -Force -ErrorAction SilentlyContinue
    $script:Queue.Clear()
    $script:Current = $null
    $callback = $script:OnFinish
    $script:OnFinish = $null
    Set-Busy $false
    if ($callback) { & $callback $Ok }
}

function Read-StepOutput($Current) {
    $stepConsole = if ($Current.Step.Console) { $Current.Step.Console } else { $console }
    foreach ($name in @("Out", "Err")) {
        $position = [long]$Current["$($name)Pos"]
        $chunk = Read-Appended $Current[$name] ([ref]$position)
        $Current["$($name)Pos"] = $position
        if ($chunk) {
            [void]$Current.Text.Append($chunk)
            if (-not $Current.Step.Silent) { Add-ColoredLines $stepConsole $chunk; Write-OwnJournal $chunk }
        }
    }
}

function Step-Tick {
    $current = $script:Current
    if (-not $current) { return }
    Read-StepOutput $current
    if (-not $current.Process.HasExited) { return }
    Read-StepOutput $current
    $code = $current.Process.ExitCode
    $step = $current.Step
    $stepConsole = if ($step.Console) { $step.Console } else { $console }
    $text = $current.Text.ToString()
    $script:Current = $null
    if ($step.OnResult) { & $step.OnResult $text $code }
    if ($code -ne 0 -and -not $step.IgnoreFailure) {
        if (-not $step.Silent) { Add-ConsoleText $stepConsole "× Операция завершилась с ошибкой.`n" $ColRed; Write-OwnJournal "× Операция завершилась с ошибкой.`n" }
        $failHook = $step.OnFail
        Complete-Steps $false
        if ($failHook) { & $failHook $text }
        return
    }
    if (-not $step.Silent -and $script:Queue.Count -eq 0) { Add-ConsoleText $stepConsole "√ Готово.`n" $ColAccent; Write-OwnJournal "√ Готово.`n" }
    Start-NextStep
}

function New-ServerStep([string]$Title, [string]$Arguments, [hashtable]$Extra = @{}) {
    $step = @{ Title = $Title; Script = $script:ServerScript; Args = "$Arguments -NoElevate"; Silent = $false }
    foreach ($key in $Extra.Keys) { $step[$key] = $Extra[$key] }
    return $step
}

# ---------------------------------------------------------------- статус
$script:SiteUrl = ""
$script:WebOp = $null
# Общий журнал с веб-панелью: показываем только то новое, что появится после открытия окна.
$script:JournalPos = $(if (Test-Path $script:JournalFile) { (Get-Item $script:JournalFile).Length } else { 0 })
$script:DiskTick = 0
$script:DiskText = "-"
$script:LabSiteUrl = ""
$script:LabDiskTick = 0
$script:LabDiskText = "-"

# update: есть новые коммиты; sync: коммитов нет, но файлы на диске отличаются от репозитория; none: делать нечего.
function Get-UpdateMode {
    $g = $script:Git
    if (-not $g -or -not $g.isRepo -or -not $g.hasCommits -or -not $g.upstream) { return "none" }
    if ($g.behind -gt 0) { return "update" }
    if ($g.dirty -gt 0) { return "sync" }
    return "none"
}

function Update-Status {
    $installed = Test-Path $script:EnvFile
    $config = Read-EnvFile $script:EnvFile
    $state = Get-ServerState

    if (-not $installed) {
        $lblState.Text = "Не установлен"
        $lblState.ForeColor = $ColYellow
        $dot.DotColor = $ColYellow; $dot.Pulse = $false
        $lblUptime.Text = "Откройте «Настройки» и нажмите «Установить»"
        $script:SiteUrl = ""
    }
    elseif ($state -and $state.ready) {
        $lblState.Text = "Работает"
        $lblState.ForeColor = $ColAccent
        $dot.DotColor = $ColAccent; $dot.Pulse = $false
        $span = (Get-Date).ToUniversalTime() - (ConvertTo-Utc $state.startedAt)
        $up = if ($span.TotalDays -ge 1) { "{0} д {1} ч" -f [int]$span.TotalDays, $span.Hours } elseif ($span.TotalHours -ge 1) { "{0} ч {1} мин" -f [int]$span.TotalHours, $span.Minutes } else { "{0} мин {1} с" -f $span.Minutes, $span.Seconds }
        $lblUptime.Text = "аптайм $up - продолжает работать, даже если закрыть это окно"
        $script:SiteUrl = $state.url
    }
    elseif ($state) {
        $lblState.Text = "Запускается..."
        $lblState.ForeColor = $ColYellow
        $dot.DotColor = $ColYellow; $dot.Pulse = $true
        $lblUptime.Text = ""
        $script:SiteUrl = $state.url
    }
    else {
        $lblState.Text = "Остановлен"
        $lblState.ForeColor = $ColRed
        $dot.DotColor = $ColRed; $dot.Pulse = $false
        $lblUptime.Text = ""
        $script:SiteUrl = if ($config["DEPLOY_DOMAIN"]) { "https://" + $config["DEPLOY_DOMAIN"] } elseif ($config["DEPLOY_IP"]) { "https://" + $config["DEPLOY_IP"] } else { "" }
    }

    $script:FieldValues["Адрес"].Text = $(if ($script:SiteUrl) { $script:SiteUrl } else { "-" })
    $procs = "-"
    if ($state) { $procs = "сайт PID {0}" -f $state.nextPid; if ($state.caddyPid) { $procs += "  ·  Caddy PID {0}" -f $state.caddyPid } }
    $script:FieldValues["Процессы"].Text = $procs
    $script:FieldValues["Автозапуск"].Text = $(if (Get-AutostartTask) { "включён" } else { "выключен" })

    $script:DiskTick++
    if ($script:DiskTick -ge 15 -or $script:DiskText -eq "-") {
        $script:DiskTick = 0
        $script:DiskText = "загрузки " + (Format-Size (Get-FolderSize (Join-Path $script:Root "uploads")))
    }
    $script:FieldValues["Диск"].Text = $script:DiskText

    $running = [bool]$state
    $free = -not $script:Busy -and -not $script:WebOp
    $btnStart.Enabled = $free -and $installed -and -not $running
    $btnStop.Enabled = $free -and $running
    $btnRestart.Enabled = $free -and $installed
    $btnOpen.Enabled = [bool]$script:SiteUrl
    Set-LocalButton $btnLocal $(if ($config["APP_PORT"]) { [int]$config["APP_PORT"] } else { 3000 }) ([bool]($state -and $state.ready))
    foreach ($b in @($btnCheck, $btnUpdate, $btnConnect, $btnApply, $btnUninstall, $btnCache, $btnScan, $btnBanner)) { if ($b) { $b.Enabled = $free -and (($b -ne $btnUninstall) -or $installed) } }
    $btnPurge.Enabled = $free -and $script:ScanFound
    $mode = Get-UpdateMode
    $btnUpdate.Enabled = $free -and ($mode -ne "none")
    $label = $(if ($mode -eq "sync") { "Синхронизировать файлы" } else { "Обновить и перезапустить" })
    if ($btnUpdate.Text -ne $label) { $btnUpdate.Text = $label }
    $btnBanner.Enabled = $free -and ($mode -eq "update")
}

# Заказы (lab) - тот же паттерн, что Update-Status, но источники данных свои (lab не делит
# скоуп с root, см. Read-LabState/Get-LabServerState выше) и без баннера обновлений/git-кнопок,
# у lab своих нет - апдейт lab идёт вместе с основным сайтом через server.bat update.
function Update-LabStatus {
    if (-not (Test-LabPresent)) {
        $lblOrdersState.Text = "Не найден"
        $lblOrdersState.ForeColor = $ColMuted
        $dotOrders.DotColor = $ColMuted; $dotOrders.Pulse = $false
        $lblOrdersUptime.Text = ""
        $script:LabSiteUrl = ""
        $script:OrdersFieldValues["Адрес"].Text = "-"
        $script:OrdersFieldValues["Процесс"].Text = "-"
        $script:OrdersFieldValues["Автозапуск"].Text = "-"
        $script:OrdersFieldValues["Диск"].Text = "-"
        $btnOrdersStart.Enabled = $false; $btnOrdersStop.Enabled = $false; $btnOrdersRestart.Enabled = $false; $btnOrdersOpen.Enabled = $false
        $btnOrdersLocal.Enabled = $false
        return
    }

    $installed = Test-Path $script:LabEnvFile
    $config = Read-EnvFile $script:LabEnvFile
    $state = Get-LabServerState

    if (-not $installed) {
        $lblOrdersState.Text = "Не установлен"
        $lblOrdersState.ForeColor = $ColYellow
        $dotOrders.DotColor = $ColYellow; $dotOrders.Pulse = $false
        $lblOrdersUptime.Text = "Установите через консоль: server.bat setup"
        $script:LabSiteUrl = ""
    }
    elseif ($state -and $state.ready) {
        $lblOrdersState.Text = "Работает"
        $lblOrdersState.ForeColor = $ColAccent
        $dotOrders.DotColor = $ColAccent; $dotOrders.Pulse = $false
        $span = (Get-Date).ToUniversalTime() - (ConvertTo-Utc $state.startedAt)
        $up = if ($span.TotalDays -ge 1) { "{0} д {1} ч" -f [int]$span.TotalDays, $span.Hours } elseif ($span.TotalHours -ge 1) { "{0} ч {1} мин" -f [int]$span.TotalHours, $span.Minutes } else { "{0} мин {1} с" -f $span.Minutes, $span.Seconds }
        $lblOrdersUptime.Text = "аптайм $up - продолжает работать, даже если закрыть это окно"
        $script:LabSiteUrl = $state.url
    }
    elseif ($state) {
        $lblOrdersState.Text = "Запускается..."
        $lblOrdersState.ForeColor = $ColYellow
        $dotOrders.DotColor = $ColYellow; $dotOrders.Pulse = $true
        $lblOrdersUptime.Text = ""
        $script:LabSiteUrl = $state.url
    }
    else {
        $lblOrdersState.Text = "Остановлен"
        $lblOrdersState.ForeColor = $ColRed
        $dotOrders.DotColor = $ColRed; $dotOrders.Pulse = $false
        $lblOrdersUptime.Text = ""
        $script:LabSiteUrl = if ($config["DEPLOY_DOMAIN"]) { "https://" + $config["DEPLOY_DOMAIN"] } else { "" }
    }

    $script:OrdersFieldValues["Адрес"].Text = $(if ($script:LabSiteUrl) { $script:LabSiteUrl } else { "-" })
    $script:OrdersFieldValues["Процесс"].Text = $(if ($state) { "процесс PID {0}" -f $state.appPid } else { "-" })
    $script:OrdersFieldValues["Автозапуск"].Text = $(if (Get-LabAutostartTask) { "включён" } else { "выключен" })

    $script:LabDiskTick++
    if ($script:LabDiskTick -ge 15 -or $script:LabDiskText -eq "-") {
        $script:LabDiskTick = 0
        $script:LabDiskText = "данные " + (Format-Size (Get-FolderSize (Join-Path $script:LabRoot "data")))
    }
    $script:OrdersFieldValues["Диск"].Text = $script:LabDiskText

    $running = [bool]$state
    $free = -not $script:Busy -and -not $script:WebOp
    $btnOrdersStart.Enabled = $free -and $installed -and -not $running
    $btnOrdersStop.Enabled = $free -and $running
    $btnOrdersRestart.Enabled = $free -and $installed
    $btnOrdersOpen.Enabled = [bool]$script:LabSiteUrl
    Set-LocalButton $btnOrdersLocal $(if ($config["PORT"]) { [int]$config["PORT"] } else { 3001 }) ([bool]($state -and $state.ready))
}

# Принтеры (Bambuddy) - служба Windows «Bambuddy» от его собственного установщика. Статус службы
# обновляется вместе с остальными; принтеры запрашиваются из API Bambuddy только пока открыта
# вкладка, раз в 3 тика (~6 с), с коротким таймаутом - запросы идут на localhost.
$script:BbUrl = ""
$script:BbPollTick = 0
$script:BbPrintersText = "-"
$script:BbLogDir = Join-Path $env:ProgramData "Bambuddy\logs"
$script:BbStates = @{ IDLE = "Свободен"; PREPARE = "Подготовка"; SLICING = "Нарезка"; RUNNING = "Печатает"; PAUSE = "Пауза"; FINISH = "Готово"; FAILED = "Ошибка печати" }

function Get-BambuddyBase($Config) {
    if ($Config["BAMBUDDY_URL"]) { return $Config["BAMBUDDY_URL"].TrimEnd("/") }
    return "http://127.0.0.1:{0}" -f (Get-BambuddyPort $Config)
}

# HttpWebRequest, а не Invoke-RestMethod: PowerShell 5.1 читает JSON без charset как Latin-1
# и портит кириллицу в именах принтеров.
function Invoke-BambuddyApi([string]$Base, [string]$Path, [string]$Key = "") {
    $request = [Net.HttpWebRequest]::Create($Base + $Path)
    $request.Timeout = 2000
    $request.ReadWriteTimeout = 2000
    $request.Proxy = $null
    if ($Key) { $request.Headers.Add("X-API-Key", $Key) }
    $response = $request.GetResponse()
    try {
        $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
        return ($reader.ReadToEnd() | ConvertFrom-Json)
    }
    finally { $response.Close() }
}

function Format-Minutes([int]$Minutes) {
    if ($Minutes -lt 60) { return "$Minutes мин" }
    if ($Minutes -lt 1440) { return "{0} ч {1} мин" -f [Math]::Floor($Minutes / 60), ($Minutes % 60) }
    return "{0} д {1} ч" -f [Math]::Floor($Minutes / 1440), [Math]::Floor(($Minutes % 1440) / 60)
}

function Format-Temp($Current, $Target) {
    if ($null -eq $Current) { return "-" }
    if ($Target) { return "{0} / {1}°C" -f [Math]::Round($Current), [Math]::Round($Target) }
    return "{0}°C" -f [Math]::Round($Current)
}

function Show-PrinterMessage([string]$Text, $Color = $null) {
    $printerView.Clear()
    Add-ConsoleText $printerView $Text $Color
}

function Update-PrinterList($Config) {
    $base = Get-BambuddyBase $Config
    $key = $Config["BAMBUDDY_API_KEY"]
    try { [void](Invoke-BambuddyApi $base "/health") }
    catch { $script:BbPrintersText = "-"; Show-PrinterMessage "Bambuddy не отвечает на $base.`nЕсли служба только что запущена - подождите полминуты." $ColYellow; return }
    if (-not $key) {
        $script:BbPrintersText = "нужен ключ"
        Show-PrinterMessage "Bambuddy работает. Чтобы увидеть здесь принтеры, создайте ключ API в Bambuddy (Settings → API Keys, права printers:read, printers:control и inventory:read) и сохраните его ниже." $ColMuted
        return
    }
    try { $printers = @(Invoke-BambuddyApi $base "/api/v1/printers/" $key) | Where-Object { $_.is_active } }
    catch {
        $code = $null
        if ($_.Exception.InnerException -is [Net.WebException] -and $_.Exception.InnerException.Response) { $code = [int]$_.Exception.InnerException.Response.StatusCode }
        $script:BbPrintersText = "ошибка"
        $message = if ($code -eq 401 -or $code -eq 403) { "Bambuddy не принял ключ API ($code) - проверьте ключ и его права." } else { "Не удалось получить список принтеров: " + $_.Exception.Message }
        Show-PrinterMessage $message $ColRed
        return
    }
    if (-not $printers) { $script:BbPrintersText = "0"; Show-PrinterMessage "В Bambuddy пока нет принтеров - добавьте их в самом Bambuddy." $ColMuted; return }

    $online = 0
    $printerView.Clear()
    foreach ($printer in $printers) {
        $status = $null
        try { $status = Invoke-BambuddyApi $base ("/api/v1/printers/{0}/status" -f $printer.id) $key } catch { }
        $connected = $status -and $status.connected
        if ($connected) { $online++ }
        $state = if (-not $connected) { "OFFLINE" } elseif ($status.state) { [string]$status.state } else { "IDLE" }
        $stateText = if ($state -eq "OFFLINE") { "Не в сети" } elseif ($script:BbStates.ContainsKey($state)) { $script:BbStates[$state] } else { $state }
        $color = switch ($state) { "OFFLINE" { $ColRed } "FAILED" { $ColRed } "PAUSE" { $ColYellow } "RUNNING" { $ColAccent } "PREPARE" { $ColAccent } default { $ColInk } }

        $title = "● " + $printer.name + $(if ($printer.model) { "  ($($printer.model))" } else { "" })
        Add-ConsoleText $printerView ($title + "   ") $color
        Add-ConsoleText $printerView ($stateText + "`n") $color
        if ($state -in @("RUNNING", "PAUSE", "PREPARE")) {
            $job = if ($status.subtask_name) { $status.subtask_name } else { $status.current_print }
            $parts = @("{0}%" -f [Math]::Round([double]$status.progress))
            if ($status.total_layers) { $parts += "слой {0}/{1}" -f $status.layer_num, $status.total_layers }
            if ($null -ne $status.remaining_time) { $parts += "осталось " + (Format-Minutes ([int]$status.remaining_time)) }
            if ($job) { Add-ConsoleText $printerView ("    $job`n") $ColInk }
            Add-ConsoleText $printerView ("    " + ($parts -join "  ·  ") + "`n") $ColMuted
        }
        if ($connected -and $status.temperatures) {
            $t = $status.temperatures
            Add-ConsoleText $printerView ("    сопло {0}  ·  стол {1}`n" -f (Format-Temp $t.nozzle $t.nozzle_target), (Format-Temp $t.bed $t.bed_target)) $ColMuted
        }
        if ($status -and @($status.hms_errors).Count -gt 0) { Add-ConsoleText $printerView ("    ошибок на принтере: {0}`n" -f @($status.hms_errors).Count) $ColRed }
        Add-ConsoleText $printerView "`n"
    }
    $printerView.SelectionStart = 0
    $printerView.ScrollToCaret()
    $script:BbPrintersText = "{0} из {1} в сети" -f $online, @($printers).Count
}

function Update-BambuddyStatus([bool]$Poll = $true) {
    $config = Read-EnvFile $script:EnvFile
    $port = Get-BambuddyPort $config
    $service = Get-Service -Name $script:BambuddyService -ErrorAction SilentlyContinue
    $domain = Get-BambuddyDomain $config["DEPLOY_DOMAIN"]
    $siteOn = Test-Path $script:BambuddySiteFile
    $script:BbUrl = if ($domain -and $siteOn) { "https://$domain" } else { "http://localhost:$port" }
    $running = $service -and $service.Status -eq "Running"

    if (-not $service) {
        $lblBbState.Text = "Не установлен"
        $lblBbState.ForeColor = $ColMuted
        $dotBb.DotColor = $ColMuted; $dotBb.Pulse = $false
        $lblBbSub.Text = "Установите Bambuddy: github.com/maziggy/bambuddy/releases (bambuddy-windows-x64-setup.exe)"
    }
    elseif ($running) {
        $lblBbState.Text = "Работает"
        $lblBbState.ForeColor = $ColAccent
        $dotBb.DotColor = $ColAccent; $dotBb.Pulse = $false
        $lblBbSub.Text = "служба Windows «Bambuddy», порт $port - обновляется из самого Bambuddy (Settings)"
    }
    elseif ([string]$service.Status -like "*Pending") {
        $lblBbState.Text = $(if ([string]$service.Status -eq "StopPending") { "Останавливается..." } else { "Запускается..." })
        $lblBbState.ForeColor = $ColYellow
        $dotBb.DotColor = $ColYellow; $dotBb.Pulse = $true
        $lblBbSub.Text = ""
    }
    else {
        $lblBbState.Text = "Остановлен"
        $lblBbState.ForeColor = $ColRed
        $dotBb.DotColor = $ColRed; $dotBb.Pulse = $false
        $lblBbSub.Text = "служба Windows «Bambuddy», порт $port"
    }

    $script:BbFieldValues["Адрес"].Text = $script:BbUrl
    $script:BbFieldValues["Поддомен"].Text = $(if (-not $domain) { "нет домена сайта" } elseif ($siteOn) { "подключён" } else { "не подключён" })
    $script:BbFieldValues["Ключ API"].Text = $(if ($config["BAMBUDDY_API_KEY"]) { "задан" } else { "не задан" })

    if ($Poll -and $script:CurrentPage -eq "printers") {
        if (-not $running) { $script:BbPrintersText = "-"; Show-PrinterMessage "Служба Bambuddy не запущена." $ColMuted }
        elseif ($script:BbPollTick % 3 -eq 0) { Update-PrinterList $config }
        $script:BbPollTick++
    }
    $script:BbFieldValues["Принтеры"].Text = $script:BbPrintersText

    $free = -not $script:Busy -and -not $script:WebOp
    $btnBbStart.Enabled = $free -and $service -and -not $running
    $btnBbStop.Enabled = $free -and $running
    $btnBbRestart.Enabled = $free -and [bool]$service
    $btnBbOpen.Enabled = [bool]$running
    Set-LocalButton $btnBbLocal $port ([bool]$running)
    $btnBbLogs.Enabled = Test-Path $script:BbLogDir
    $btnBbKey.Enabled = $free -and (Test-Path $script:EnvFile)
    $btnBbSite.Enabled = $free -and [bool]$domain
}

# ---------------------------------------------------------------- обновления из git
$script:Git = $null
$script:ScanFound = $false

function Update-UpdatesView {
    $git = $script:Git
    $cardConnect.Visible = $false
    $cardVersion.Visible = $true
    if (-not $git) {
        $script:UpdateValues["Статус"].Text = "ещё не проверялось"
        $script:UpdateValues["Статус"].ForeColor = $ColMuted
        return
    }
    if (-not $git.gitInstalled) {
        $script:UpdateValues["Статус"].Text = "git не установлен: winget install Git.Git"
        $script:UpdateValues["Статус"].ForeColor = $ColRed
        return
    }
    if (-not $git.isRepo -or -not $git.hasCommits) {
        $cardVersion.Visible = $false
        $cardConnect.Visible = $true
        if ($git.remote -and $inUrl.Text -like "*ВАШ_*") { $inUrl.Text = $git.remote }
        $cLbl.Text = $(if ($git.isRepo) { "Репозиторий подключён не до конца. Проверьте адрес и нажмите «Подключить»." } else { "Папка не подключена к git. Укажите репозиторий, из которого сайт будет обновляться." })
        return
    }

    $version = "{0}  ·  {1}  ·  {2}" -f $git.head, $git.headDate, $git.headMessage
    $script:UpdateValues["Версия"].Text = $version
    $script:UpdateValues["Ветка"].Text = $(if ($git.upstream) { "{0}  →  {1}" -f $git.branch, $git.upstream } else { $git.branch })
    $script:UpdateValues["Репозиторий"].Text = $(if ($git.remote) { $git.remote } else { "не задан" })
    $status = $script:UpdateValues["Статус"]
    if ($git.error) { $status.Text = "нет связи с репозиторием"; $status.ForeColor = $ColRed }
    elseif (-not $git.upstream) { $status.Text = "ветка не привязана к удалённому репозиторию"; $status.ForeColor = $ColYellow }
    elseif ($git.behind -gt 0) { $status.Text = "доступно обновлений: {0}" -f $git.behind; $status.ForeColor = $ColAccent }
    elseif ($git.dirty -gt 0) { $status.Text = "файлы на диске отличаются от репозитория: {0}" -f $git.dirty; $status.ForeColor = $ColYellow }
    elseif ($git.ahead -gt 0) { $status.Text = "актуально (локально на {0} коммит. новее)" -f $git.ahead; $status.ForeColor = $ColAccent }
    else { $status.Text = "установлена последняя версия"; $status.ForeColor = $ColAccent }

    $lblUpdHint.Text = $(switch (Get-UpdateMode) {
        "update" { if (Test-Path $script:EnvFile) { "" } else { "Сервер здесь не установлен - обновится только код (без пересборки и перезапуска)." } }
        "sync" { "Коммитов нет, но файлы отличаются - «Синхронизировать» заменит их версией из репозитория." }
        default { "Обновлений нет - версия актуальна." }
    })
    $commitList.Items.Clear()
    foreach ($line in $git.commits) { [void]$commitList.Items.Add($line) }
    if ($git.error) { [void]$commitList.Items.Add($git.error) }
}

function Update-Banner {
    $git = $script:Git
    if ($git -and $git.isRepo -and $git.behind -gt 0) {
        $lblBanner.Text = "Доступно обновление сайта: новых коммитов - {0}" -f $git.behind
        $bannerUpdate.Visible = $true
        $versionLabel.Text = "есть обновление"
        $versionLabel.ForeColor = $ColAccent
    }
    else {
        $bannerUpdate.Visible = $false
        $versionLabel.Text = $(if ($git -and $git.head) { "версия " + $git.head } else { "" })
        $versionLabel.ForeColor = $ColMuted
    }
}

function Start-GitCheck([bool]$Manual = $false) {
    if ($script:Busy) { return }
    $script:ManualCheck = $Manual
    $step = New-ServerStep "Проверка обновлений" "git-check" @{
        Silent = $true; IgnoreFailure = $true
        OnResult = {
            param($text, $code)
            $json = ($text -split "`n" | Where-Object { $_.TrimStart().StartsWith("{") } | Select-Object -Last 1)
            if ($json) { try { $script:Git = $json | ConvertFrom-Json } catch { } }
            Update-Banner
            Update-UpdatesView
            if ($script:ManualCheck -and $script:Git -and $script:Git.isRepo -and -not $script:Git.error) {
                Add-ConsoleText $console ($(if ($script:Git.behind -gt 0) { "Найдено обновлений: {0}`n" -f $script:Git.behind } else { "Обновлений нет - версия актуальна.`n" })) $ColAccent
            }
        }
    }
    Add-Steps @($step)
}

function Start-Update([bool]$Force = $false) {
    if (-not $Force -and (Get-UpdateMode) -eq "sync") {
        $answer = [Windows.Forms.MessageBox]::Show(("Файлы в папке сайта отличаются от версии в репозитории ({0} шт.).`n`nЗаменить их версией из репозитория? (файлы .env и загрузки не затрагиваются)" -f $script:Git.dirty), "Синхронизация", "YesNo", "Question")
        if ($answer -ne "Yes") { return }
        $Force = $true
    }
    $arguments = "update -Yes"
    if ($Force) { $arguments += " -Force" }
    $step = New-ServerStep "Обновление сайта" $arguments @{
        OnFail = {
            param($text)
            if ($text -match "локальные изменения") {
                $answer = [Windows.Forms.MessageBox]::Show("Локальные изменения в папке сайта мешают обновлению.`n`nОтбросить их и обновить принудительно? (файлы .env и загрузки не затрагиваются)", "Обновление", "YesNo", "Warning")
                if ($answer -eq "Yes") { Start-Update $true }
            }
        }
    }
    Add-Steps @($step) {
        param($ok)
        if ($ok) { Restart-IfAppChanged }
        Start-GitCheck
    }
    Show-Page "overview"
}

# Обновление могло изменить и само окно - тогда перезапускаем его на новой версии.
function Restart-IfAppChanged {
    $newHash = (Get-FileHash -Path $PSCommandPath -Algorithm SHA256).Hash
    if ($newHash -eq $script:AppHash) { return }
    [void][Windows.Forms.MessageBox]::Show("Приложение обновилось. Оно сейчас перезапустится.", "Обновление", "OK", "Information")
    $exePath = Join-Path $script:Root "Lab3D.exe"
    if (Test-Path $exePath) { Start-Process -FilePath $exePath }
    else { Start-Process -FilePath "powershell.exe" -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "{0}"' -f $PSCommandPath) }
    $script:ForceClose = $true
    $form.Close()
}

# ---------------------------------------------------------------- обработчики кнопок
$btnStart.Add_Click({ Add-Steps @((New-ServerStep "Запуск сервера" "start")) })
$btnStop.Add_Click({ Add-Steps @((New-ServerStep "Остановка сервера" "stop")) })
$btnRestart.Add_Click({ Add-Steps @((New-ServerStep "Перезапуск сервера" "restart")) })
$btnOpen.Add_Click({ if ($script:SiteUrl) { Start-Process $script:SiteUrl } })
$btnClearJournal.Add_Click({ $console.Clear() })

function New-LabServerStep([string]$Title, [string]$Arguments) {
    return @{ Title = $Title; Script = $script:LabServerScript; Args = "$Arguments -NoElevate"; Silent = $false; Console = $consoleOrders; LogDir = $script:LabLogDir }
}
$btnOrdersStart.Add_Click({ Add-Steps @((New-LabServerStep "Запуск «Заказы»" "start")) })
$btnOrdersStop.Add_Click({ Add-Steps @((New-LabServerStep "Остановка «Заказы»" "stop")) })
$btnOrdersRestart.Add_Click({ Add-Steps @((New-LabServerStep "Перезапуск «Заказы»" "restart")) })
$btnOrdersOpen.Add_Click({ if ($script:LabSiteUrl) { Start-Process $script:LabSiteUrl } })
$btnOrdersClearJournal.Add_Click({ $consoleOrders.Clear() })
function New-BambuddyStep([string]$Title, [string]$Arguments) {
    return (New-ServerStep $Title $Arguments @{ Console = $consoleBb })
}
$btnBbStart.Add_Click({ Add-Steps @((New-BambuddyStep "Запуск Bambuddy" "bambuddy-start")) })
$btnBbStop.Add_Click({ Add-Steps @((New-BambuddyStep "Остановка Bambuddy" "bambuddy-stop")) })
$btnBbRestart.Add_Click({ Add-Steps @((New-BambuddyStep "Перезапуск Bambuddy" "bambuddy-restart")) })
$btnBbOpen.Add_Click({ if ($script:BbUrl) { Start-Process $script:BbUrl } })
$btnBbLogs.Add_Click({ if (Test-Path $script:BbLogDir) { Start-Process explorer.exe $script:BbLogDir } })
$btnBbSite.Add_Click({ Add-Steps @((New-BambuddyStep "Подключение поддомена Bambuddy" "bambuddy-site")) })
$btnBbKey.Add_Click({
    $key = $inBbKey.Text.Trim()
    if (-not $key) { [void][Windows.Forms.MessageBox]::Show("Вставьте ключ API из Bambuddy (Settings → API Keys).", "Ключ API", "OK", "Information"); return }
    $config = Read-EnvFile $script:EnvFile
    $config["BAMBUDDY_API_KEY"] = $key
    if (-not $config["BAMBUDDY_URL"]) { $config["BAMBUDDY_URL"] = Get-BambuddyBase $config }
    Write-EnvFile $script:EnvFile $config
    $inBbKey.Text = ""
    Add-ConsoleText $consoleBb "Ключ API сохранён.`n" $ColAccent
    $script:BbPollTick = 0
    Update-BambuddyStatus
    # Сайт читает .env.production только при запуске - без перезапуска админка ключа не увидит.
    if (Get-ServerState) {
        $answer = [Windows.Forms.MessageBox]::Show("Перезапустить сайт, чтобы страница «Принтеры» в админке начала работать с новым ключом?", "Ключ API", "YesNo", "Question")
        if ($answer -eq "Yes") { Add-Steps @((New-BambuddyStep "Перезапуск сайта" "restart")) }
    }
})
$btnPanelOpen.Add_Click({ if ($script:PanelUrl) { Start-Process $script:PanelUrl } })
$btnPanelEnable.Add_Click({
    $password = $inPanelPass.Text
    $hasPassword = [bool](Read-EnvFile $script:EnvFile)["PANEL_PASSWORD"]
    if (-not $password -and -not $hasPassword) { [void][Windows.Forms.MessageBox]::Show("Придумайте пароль для входа в веб-панель.", "Веб-панель", "OK", "Information"); return }
    if ($password -and $password.Length -lt 10) { [void][Windows.Forms.MessageBox]::Show("Пароль - не короче 10 символов.", "Веб-панель", "OK", "Information"); return }
    $steps = @()
    if ($password) {
        # Пароль - через переменную окружения дочернего процесса, не в командной строке.
        $env:LAB3D_PANEL_PASSWORD = $password
        $steps += (New-ServerStep "Пароль веб-панели" "panel-password")
    }
    # Панель читает пароль при каждом входе - уже включённую перезапускать ради нового пароля не нужно.
    if (-not (Get-ScheduledTask -TaskName $script:PanelTaskName -ErrorAction SilentlyContinue) -or -not $password) {
        $steps += (New-ServerStep "Включение веб-панели" "panel-install")
    }
    Add-Steps $steps { param($ok) Remove-Item Env:LAB3D_PANEL_PASSWORD -ErrorAction SilentlyContinue; $inPanelPass.Text = ""; Update-PanelStatus }
})
$btnPanelDisable.Add_Click({
    $answer = [Windows.Forms.MessageBox]::Show("Выключить веб-панель? Управлять сервером из браузера станет нельзя.", "Веб-панель", "YesNo", "Question")
    if ($answer -eq "Yes") { Add-Steps @((New-ServerStep "Выключение веб-панели" "panel-remove")) { param($ok) Update-PanelStatus } }
})
$btnCheck.Add_Click({ Start-GitCheck $true })
$btnUpdate.Add_Click({ Start-Update })
$btnBanner.Add_Click({ Start-Update })
$btnConnect.Add_Click({
    $url = $inUrl.Text.Trim()
    $branch = $inBranch.Text.Trim()
    if (-not $url -or $url -like "*ВАШ_*") { [void][Windows.Forms.MessageBox]::Show("Укажите адрес репозитория.", "Подключение", "OK", "Information"); return }
    Add-Steps @((New-ServerStep "Подключение репозитория" ("git-connect {0} {1}" -f (ConvertTo-Arg $url), (ConvertTo-Arg $(if ($branch) { $branch } else { "auto" }))))) { param($ok) Start-GitCheck }
    Show-Page "overview"
})

$btnApply.Add_Click({
    $config = Read-EnvFile $script:EnvFile
    $first = ($config.Count -eq 0)
    $db = ""
    $existingDb = $config["DATABASE_URL"]
    if ($inDbUrl.Visible -and $inDbUrl.Text.Trim()) { $db = $inDbUrl.Text.Trim() }
    elseif ($inDbPass.Text) { $db = Build-DbUrl (ConvertFrom-DbUrl $existingDb) $inDbPass.Text }
    elseif ($existingDb) { $db = $existingDb }
    if (-not $db) { [void][Windows.Forms.MessageBox]::Show("Введите пароль PostgreSQL - тот, что вы задали при установке PostgreSQL.", "Установка", "OK", "Information"); return }
    $pass = $inPass.Text
    if ($pass -and $pass.Length -lt 8) { [void][Windows.Forms.MessageBox]::Show("Пароль админа - не короче 8 символов.", "Установка", "OK", "Information"); return }

    $setupArgs = "-Domain {0} -DatabaseUrl {1}" -f (ConvertTo-Arg $inDomain.Text.Trim()), (ConvertTo-Arg $db)
    if ($first) { $setupArgs += " -AdminEmail {0}" -f (ConvertTo-Arg $(if ($inAdmin.Text.Trim()) { $inAdmin.Text.Trim() } else { "admin" })) }
    if ($pass) { $setupArgs += " -AdminPassword {0}" -f (ConvertTo-Arg $pass); if (-not $first) { $setupArgs += " -AdminEmail {0}" -f (ConvertTo-Arg $inAdmin.Text.Trim()) } }
    $wasRunning = [bool](Get-ServerState)
    $wantAutostart = [bool]$chkAutostart.Checked
    $hadAutostart = [bool](Get-AutostartTask)

    $steps = @()
    if ($wasRunning) { $steps += (New-ServerStep "Остановка сервера" "stop") }
    # If setup fails, start the site again - it was stopped above and must not stay down.
    $script:ApplyWasRunning = $wasRunning
    $steps += @{
        Title = "Установка и настройка"; Script = (Join-Path $PSScriptRoot "setup.ps1"); Args = $setupArgs; Silent = $false
        OnFail = { param($text) if ($script:ApplyWasRunning) { Add-Steps @((New-ServerStep "Запуск сервера" "start")) } }
    }
    if ($wantAutostart -ne $hadAutostart) {
        $steps += @{ Title = $(if ($wantAutostart) { "Включение автозапуска" } else { "Выключение автозапуска" }); Script = (Join-Path $PSScriptRoot "install-autostart.ps1"); Args = $(if ($wantAutostart) { "" } else { "-Remove" }); Silent = $false }
    }
    if ($wasRunning -or $first) { $steps += (New-ServerStep "Запуск сервера" "start") }
    Add-Steps $steps { param($ok) $inPass.Text = ""; $inDbPass.Text = "" }
    Show-Page "overview"
})

$btnUninstall.Add_Click({
    $answer = [Windows.Forms.MessageBox]::Show("Будут удалены: автозапуск, правило брандмауэра, настройки и логи.`nБаза данных и папка uploads остаются.`n`nУдалить установку?", "Удаление", "YesNo", "Warning")
    if ($answer -ne "Yes") { return }
    $modules = [Windows.Forms.MessageBox]::Show("Удалить также node_modules и сборку .next?`n(вернутся при следующей установке)", "Удаление", "YesNo", "Question")
    $arguments = "uninstall -Yes"
    if ($modules -eq "Yes") { $arguments += " -RemoveModules" }
    Add-Steps @((New-ServerStep "Удаление установки" $arguments))
    Show-Page "overview"
})

$btnCache.Add_Click({
    Add-Steps @((New-ServerStep "Очистка кэша сборки и логов" "cleanup-cache"))
    Show-Page "overview"
})

$btnScan.Add_Click({
    $days = (Get-Days)
    $script:ScanFound = $false
    $lblScan.Text = "Проверяю..."
    $lblScan.ForeColor = $ColMuted
    $step = New-ServerStep "Поиск неиспользуемых загрузок" ("uploads-scan {0}" -f $days) @{
        Silent = $true; IgnoreFailure = $true
        OnResult = {
            param($text, $code)
            $json = ($text -split "`n" | Where-Object { $_.TrimStart().StartsWith("{") } | Select-Object -Last 1)
            try { $scan = $json | ConvertFrom-Json } catch { $lblScan.Text = "Не удалось проверить: " + $text.Trim(); $lblScan.ForeColor = $ColRed; return }
            $lblScan.Text = "Без заказов: {0} файл. · {1}`nБез записи в базе: {2} файл. · {3}" -f $scan.unused.count, (Format-Size $scan.unused.bytes), $scan.orphans.count, (Format-Size $scan.orphans.bytes)
            $script:ScanFound = (($scan.unused.count + $scan.orphans.count) -gt 0)
            $lblScan.ForeColor = $(if ($script:ScanFound) { $ColInk } else { $ColAccent })
            if (-not $script:ScanFound) { $lblScan.Text = "Лишнего нет." }
        }
    }
    Add-Steps @($step)
})

$btnPurge.Add_Click({
    $answer = [Windows.Forms.MessageBox]::Show("Удалить найденные файлы безвозвратно?", "Очистка", "YesNo", "Warning")
    if ($answer -ne "Yes") { return }
    $days = (Get-Days)
    $script:ScanFound = $false
    Add-Steps @((New-ServerStep "Удаление неиспользуемых загрузок" ("uploads-delete {0}" -f $days) @{
        Silent = $true
        OnResult = { param($text, $code) if ($code -eq 0) { $lblScan.Text = "Удалено."; $lblScan.ForeColor = $ColAccent } else { $lblScan.Text = "Ошибка: " + $text.Trim(); $lblScan.ForeColor = $ColRed } }
    }))
})

# ---------------------------------------------------------------- таймеры и запуск
$pump = New-Object Windows.Forms.Timer
$pump.Interval = 400
$pump.Add_Tick({
    Step-Tick
    # Операции из веб-панели (и прочие чужие строки журнала) - в журнал «Обзора», пока своя не идёт.
    if (-not ($script:Current -and -not $script:Current.Step.Silent)) {
        $chunk = Read-Appended $script:JournalFile ([ref]$script:JournalPos)
        if ($chunk) { Add-ColoredLines $console $chunk }
    }
    if ($script:CurrentPage -eq "logs") {
        $path = $logSources[$script:LogKey]
        $chunk = Read-Appended $path ([ref]$script:LogPos)
        if ($chunk) { Add-ColoredLines $logView $chunk }
    }
})
$statusTimer = New-Object Windows.Forms.Timer
$statusTimer.Interval = 2000
$statusTimer.Add_Tick({
    $script:WebOp = Get-WebOperation
    Update-Status; Update-LabStatus; Update-BambuddyStatus
    if ($script:CurrentPage -eq "panel") { Update-PanelStatus }
})
$updateTimer = New-Object Windows.Forms.Timer
$updateTimer.Interval = 30 * 60 * 1000
$updateTimer.Add_Tick({ if ([bool](Get-Settings).autoCheck) { Start-GitCheck } })

$script:ForceClose = $false
$form.Add_FormClosing({
    if ($script:Current -and -not $script:ForceClose) {
        $answer = [Windows.Forms.MessageBox]::Show("Сейчас выполняется операция. Закрыть окно? (сама операция продолжится в фоне)", "Лаборатория 3Д", "YesNo", "Question")
        if ($answer -ne "Yes") { $_.Cancel = $true }
    }
})
$form.Add_Shown({
    try { $dark = 1; [void][Native.Win]::DwmSetWindowAttribute($form.Handle, 20, [ref]$dark, 4) } catch { }
    Update-Status
    Update-LabStatus
    Update-BambuddyStatus $false
    Show-Page "overview"
    $pump.Start()
    $statusTimer.Start()
    $updateTimer.Start()
    if ([bool](Get-Settings).autoCheck) { Start-GitCheck }
})

# Всё окно собрано для 100% - растягиваем координаты, размеры и строки таблиц под масштаб экрана.
if ($script:UiScale -ne 1) {
    $form.Scale((New-Object Drawing.SizeF($script:UiScale, $script:UiScale)))
    $form.MinimumSize = New-Object Drawing.Size((Px 1000), (Px 680))
}

if ($Snapshot) {
    New-Item -ItemType Directory -Force -Path $Snapshot | Out-Null
    $form.StartPosition = "Manual"
    $form.Location = New-Object Drawing.Point(-4000, -4000)
    $form.Show()
    function Wait-Idle { $end = (Get-Date).AddSeconds(90); while ((Get-Date) -lt $end -and $script:Busy) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 } }
    for ($i = 0; $i -lt 20; $i++) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    Wait-Idle
    if ($env:LAB3D_SNAPSHOT_TASK) {
        Add-Steps @((New-ServerStep "Проверка журнала" $env:LAB3D_SNAPSHOT_TASK))
        Wait-Idle
        for ($i = 0; $i -lt 25; $i++) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 100 }
    }
    foreach ($name in @("overview", "printers", "logs", "updates", "settings", "panel", "cleanup")) {
        Show-Page $name
        for ($i = 0; $i -lt 8; $i++) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 60 }
        $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
        $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
        $bitmap.Save((Join-Path $Snapshot "$name.png"), [Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
    }
    [IO.File]::WriteAllText((Join-Path $Snapshot "console.txt"), $console.Text, (New-Object Text.UTF8Encoding($false)))
    $script:ForceClose = $true
    $form.Close()
    return
}

# Одно окно на компьютер (после самообновления новое окно ждёт, пока закроется старое).
$instance = New-Object Threading.Mutex($false, "Global\Lab3DServerApp")
$owned = $false
try { $owned = $instance.WaitOne(8000) } catch [Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
    [void][Windows.Forms.MessageBox]::Show("Окно управления уже открыто.", "Лаборатория 3Д", "OK", "Information")
    return
}

[Windows.Forms.Application]::Run($form)
