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
Add-Type -Namespace Native -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
[DllImport("uxtheme.dll", CharSet = CharSet.Unicode)] public static extern int SetWindowTheme(IntPtr hwnd, string appName, string idList);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, string lParam);
'@
[void][Native.Win]::SetProcessDPIAware()
[Windows.Forms.Application]::EnableVisualStyles()

$script:ServerScript = Join-Path $PSScriptRoot "server.ps1"
$script:SettingsFile = Join-Path $PSScriptRoot "app-settings.json"
$script:AppHash = (Get-FileHash -Path $PSCommandPath -Algorithm SHA256).Hash

# ---------------------------------------------------------------- палитра и виджеты
function New-Color([int]$R, [int]$G, [int]$B) { return [Drawing.Color]::FromArgb($R, $G, $B) }
$ColBg = New-Color 10 10 10
$ColSide = New-Color 16 16 18
$ColCard = New-Color 24 24 27
$ColField = New-Color 32 32 36
$ColLine = New-Color 48 48 54
$ColInk = New-Color 232 232 232
$ColMuted = New-Color 140 140 148
$ColAccent = New-Color 127 191 127
$ColAccentDark = New-Color 11 31 11
$ColRed = New-Color 226 100 100
$ColYellow = New-Color 232 190 90

function New-Font([single]$Size = 10, [bool]$Bold = $false) {
    $style = if ($Bold) { [Drawing.FontStyle]::Bold } else { [Drawing.FontStyle]::Regular }
    return New-Object Drawing.Font("Segoe UI", $Size, $style)
}

function New-Label([string]$Content, [single]$Size = 10, $Color = $ColInk, [bool]$Bold = $false) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $Content
    $label.AutoSize = $true
    $label.ForeColor = $Color
    $label.BackColor = [Drawing.Color]::Transparent
    $label.Font = New-Font $Size $Bold
    return $label
}

function Set-ButtonLook($Button) {
    if (-not $Button.Enabled) {
        $Button.BackColor = $ColCard
        $Button.ForeColor = New-Color 88 88 94
        $Button.FlatAppearance.BorderColor = $ColLine
        return
    }
    switch ($Button.Tag) {
        "primary" { $Button.BackColor = $ColAccent; $Button.ForeColor = $ColAccentDark; $Button.FlatAppearance.BorderColor = $ColAccent }
        "danger" { $Button.BackColor = $ColCard; $Button.ForeColor = $ColRed; $Button.FlatAppearance.BorderColor = $ColRed }
        default { $Button.BackColor = $ColField; $Button.ForeColor = $ColInk; $Button.FlatAppearance.BorderColor = $ColLine }
    }
}

function New-Button([string]$Content, [string]$Kind = "secondary", [int]$Width = 150) {
    $button = New-Object Windows.Forms.Button
    $button.Text = $Content
    $button.Width = $Width
    $button.Height = 38
    $button.FlatStyle = "Flat"
    $button.Cursor = "Hand"
    $button.Font = New-Font 10 ($Kind -eq "primary")
    $button.Margin = New-Object Windows.Forms.Padding(0, 0, 10, 0)
    $button.FlatAppearance.BorderSize = 1
    switch ($Kind) {
        "primary" { $button.BackColor = $ColAccent; $button.ForeColor = $ColAccentDark; $button.FlatAppearance.BorderColor = $ColAccent }
        "danger" { $button.BackColor = $ColCard; $button.ForeColor = $ColRed; $button.FlatAppearance.BorderColor = $ColRed }
        default { $button.BackColor = $ColField; $button.ForeColor = $ColInk; $button.FlatAppearance.BorderColor = $ColLine }
    }
    $button.Tag = $Kind
    $button.Add_EnabledChanged({ Set-ButtonLook $this })
    return $button
}

function New-Input([string]$Value = "", [bool]$Secret = $false, [string]$Hint = "") {
    $box = New-Object Windows.Forms.TextBox
    $box.Text = $Value
    $box.BackColor = $ColField
    $box.ForeColor = $ColInk
    $box.BorderStyle = "FixedSingle"
    $box.Font = New-Font 10
    $box.Dock = "Fill"
    $box.Margin = New-Object Windows.Forms.Padding(0, 4, 0, 4)
    if ($Secret) { $box.UseSystemPasswordChar = $true }
    if ($Hint) { $box.Tag = $Hint; $box.Add_HandleCreated({ [void][Native.Win]::SendMessage($this.Handle, 0x1501, 1, [string]$this.Tag) }) }
    return $box
}

function New-Panel($Color = $ColCard) {
    $panel = New-Object Windows.Forms.Panel
    $panel.BackColor = $Color
    return $panel
}

function New-Table([string[]]$Rows, [int]$Columns = 1) {
    $table = New-Object Windows.Forms.TableLayoutPanel
    $table.Dock = "Fill"
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
    try { [void][Native.Win]::SetWindowTheme($Control.Handle, "DarkMode_Explorer", $null) } catch { }
}

function New-Console {
    $box = New-Object Windows.Forms.RichTextBox
    $box.BackColor = New-Color 14 14 16
    $box.ForeColor = $ColMuted
    $box.BorderStyle = "None"
    $box.ReadOnly = $true
    $box.Font = New-Object Drawing.Font("Consolas", 9.5)
    $box.Dock = "Fill"
    $box.DetectUrls = $false
    $box.Margin = New-Object Windows.Forms.Padding(0)
    $box.HideSelection = $false
    $box.Add_HandleCreated({ Set-DarkScroll $this })
    return $box
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
        if ($line -match "^\s*==>") { $color = New-Color 110 190 220 }
        elseif ($line -match "ошибк|error|не удал|не найден|не запустил|failed|fatal") { $color = $ColRed }
        elseif ($line -match "warn|предупрежд|\s!\s") { $color = $ColYellow }
        elseif ($line -match "готово|запущен|остановлен|завершен|актуал|обновлён") { $color = $ColAccent }
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

function ConvertTo-Arg([string]$Value) { return '"' + ($Value -replace '"', '\"') + '"' }

# ---------------------------------------------------------------- главное окно
$form = New-Object Windows.Forms.Form
$form.Text = "Лаборатория 3Д - сервер"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object Drawing.Size(1040, 700)
$form.MinimumSize = New-Object Drawing.Size(940, 640)
$form.BackColor = $ColBg
$form.ForeColor = $ColInk
$form.Font = New-Font 10
$exe = Join-Path $script:Root "Lab3D.exe"
if (Test-Path $exe) { try { $form.Icon = [Drawing.Icon]::ExtractAssociatedIcon($exe) } catch { } }

$sidebar = New-Panel $ColSide
$sidebar.Dock = "Left"
$sidebar.Width = 220
$content = New-Panel $ColBg
$content.Dock = "Fill"
$content.Padding = New-Object Windows.Forms.Padding(28, 24, 28, 24)
$form.Controls.Add($content)
$form.Controls.Add($sidebar)

$brand = New-Label "ЛАБОРАТОРИЯ 3Д" 13 $ColAccent $true
$brand.Location = New-Object Drawing.Point(22, 22)
$brandSub = New-Label "управление сервером" 9 $ColMuted
$brandSub.Location = New-Object Drawing.Point(23, 48)
$sidebar.Controls.AddRange(@($brand, $brandSub))

$script:Pages = @{}
$script:NavButtons = @{}
$navItems = @(@("overview", "Обзор"), @("logs", "Логи"), @("updates", "Обновления"), @("settings", "Настройки"), @("cleanup", "Очистка"))
$y = 100
foreach ($item in $navItems) {
    $nav = New-Object Windows.Forms.Button
    $nav.Text = "   " + $item[1]
    $nav.Tag = $item[0]
    $nav.SetBounds(0, $y, 220, 44)
    $nav.FlatStyle = "Flat"
    $nav.FlatAppearance.BorderSize = 0
    $nav.TextAlign = "MiddleLeft"
    $nav.Font = New-Font 10.5
    $nav.Cursor = "Hand"
    $nav.BackColor = $ColSide
    $nav.ForeColor = $ColMuted
    $nav.Add_Click({ Show-Page ([string]$this.Tag) })
    $sidebar.Controls.Add($nav)
    $script:NavButtons[$item[0]] = $nav
    $y += 46
}
$versionLabel = New-Label "" 8.5 $ColMuted
$versionLabel.Location = New-Object Drawing.Point(22, 640)
$sidebar.Controls.Add($versionLabel)
$sidebar.Add_Resize({ $versionLabel.Top = $sidebar.Height - 50 })

function Show-Page([string]$Name) {
    foreach ($key in $script:Pages.Keys) { $script:Pages[$key].Visible = ($key -eq $Name) }
    foreach ($key in $script:NavButtons.Keys) {
        $active = ($key -eq $Name)
        $script:NavButtons[$key].BackColor = $(if ($active) { $ColCard } else { $ColSide })
        $script:NavButtons[$key].ForeColor = $(if ($active) { $ColAccent } else { $ColMuted })
    }
    $script:CurrentPage = $Name
    if ($Name -eq "logs") { Reset-LogView }
    if ($Name -eq "updates") { Update-UpdatesView }
    if ($Name -eq "settings") { Load-SettingsValues }
}

function Add-Page([string]$Name, $Control) {
    $Control.Dock = "Fill"
    $Control.Visible = $false
    $content.Controls.Add($Control)
    $script:Pages[$Name] = $Control
}

function New-Heading([string]$Title, [string]$Subtitle) {
    $panel = New-Panel $ColBg
    $panel.Dock = "Fill"
    $t = New-Label $Title 18 $ColInk $true
    $t.Location = New-Object Drawing.Point(0, 0)
    $s = New-Label $Subtitle 9.5 $ColMuted
    $s.Location = New-Object Drawing.Point(2, 38)
    $panel.Controls.AddRange(@($t, $s))
    return $panel
}

# ---------------------------------------------------------------- страница: обзор
$pOverview = New-Table @(70, 222, 56, "auto", 30, "*")
$pOverview.Controls.Add((New-Heading "Обзор" "Состояние сайта и быстрые действия"), 0, 0)

$cardStatus = New-Panel $ColCard
$cardStatus.Dock = "Fill"
$cardStatus.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 12)
$lblState = New-Label "..." 20 $ColInk $true
$lblState.Location = New-Object Drawing.Point(22, 16)
$lblUptime = New-Label "" 10 $ColMuted
$lblUptime.Location = New-Object Drawing.Point(24, 58)
$cardStatus.Controls.AddRange(@($lblState, $lblUptime))
$fieldNames = @("Адрес", "Процессы", "Автозапуск", "Диск")
$script:FieldValues = @{}
$fy = 92
foreach ($name in $fieldNames) {
    $k = New-Label $name 10 $ColMuted
    $k.Location = New-Object Drawing.Point(24, $fy)
    if ($name -eq "Адрес") {
        $v = New-Object Windows.Forms.LinkLabel
        $v.AutoSize = $true
        $v.Font = New-Font 10
        $v.LinkColor = New-Color 110 190 220
        $v.ActiveLinkColor = $ColAccent
        $v.VisitedLinkColor = New-Color 110 190 220
        $v.BackColor = [Drawing.Color]::Transparent
        $v.Text = "-"
        $v.Add_LinkClicked({ if ($script:SiteUrl) { Start-Process $script:SiteUrl } })
    }
    else { $v = New-Label "-" 10 $ColInk }
    $v.Location = New-Object Drawing.Point(130, $fy)
    $cardStatus.Controls.AddRange(@($k, $v))
    $script:FieldValues[$name] = $v
    $fy += 26
}
$pOverview.Controls.Add($cardStatus, 0, 1)

$actions = New-Object Windows.Forms.FlowLayoutPanel
$actions.Dock = "Fill"
$actions.BackColor = $ColBg
$btnStart = New-Button "Запустить" "primary" 150
$btnStop = New-Button "Остановить" "secondary" 150
$btnRestart = New-Button "Перезапустить" "secondary" 150
$btnOpen = New-Button "Открыть сайт" "secondary" 150
$actions.Controls.AddRange(@($btnStart, $btnStop, $btnRestart, $btnOpen))
$pOverview.Controls.Add($actions, 0, 2)

$bannerUpdate = New-Panel (New-Color 18 34 20)
$bannerUpdate.Dock = "Fill"
$bannerUpdate.Height = 52
$bannerUpdate.Visible = $false
$bannerUpdate.Margin = New-Object Windows.Forms.Padding(0, 6, 0, 0)
$lblBanner = New-Label "" 10 $ColAccent $true
$lblBanner.Location = New-Object Drawing.Point(16, 15)
$btnBanner = New-Button "Обновить" "primary" 130
$btnBanner.Height = 32
$btnBanner.Anchor = "Top,Right"
$btnBanner.Location = New-Object Drawing.Point(($bannerUpdate.Width - 150), 10)
$bannerUpdate.Add_Resize({ $btnBanner.Left = $bannerUpdate.Width - 146 })
$bannerUpdate.Controls.AddRange(@($lblBanner, $btnBanner))
$pOverview.Controls.Add($bannerUpdate, 0, 3)

$consoleTitle = New-Label "Журнал действий" 9.5 $ColMuted
$consoleTitle.Margin = New-Object Windows.Forms.Padding(2, 10, 0, 0)
$pOverview.Controls.Add($consoleTitle, 0, 4)
$console = New-Console
$pOverview.Controls.Add($console, 0, 5)
Add-Page "overview" $pOverview

# ---------------------------------------------------------------- страница: логи
$pLogs = New-Table @(70, 44, "*")
$pLogs.Controls.Add((New-Heading "Логи" "Живой вывод сайта, ошибок, HTTPS и событий сервера"), 0, 0)
$logBar = New-Object Windows.Forms.FlowLayoutPanel
$logBar.Dock = "Fill"
$logBar.BackColor = $ColBg
$logCombo = New-Object Windows.Forms.ComboBox
$logCombo.DropDownStyle = "DropDownList"
$logCombo.FlatStyle = "Flat"
$logCombo.BackColor = $ColField
$logCombo.ForeColor = $ColInk
$logCombo.Font = New-Font 10
$logCombo.Width = 300
$logSources = [ordered]@{ "Сайт" = "next.log"; "Ошибки сайта" = "next-error.log"; "HTTPS (Caddy)" = "caddy-error.log"; "События сервера" = "supervisor.log"; "Журнал операций" = "gui-task-out.log" }
foreach ($key in $logSources.Keys) { [void]$logCombo.Items.Add($key) }
$logCombo.SelectedIndex = 0
$logBar.Controls.Add($logCombo)
$pLogs.Controls.Add($logBar, 0, 1)
$logView = New-Console
$pLogs.Controls.Add($logView, 0, 2)
Add-Page "logs" $pLogs
$script:LogPos = 0

function Reset-LogView {
    $logView.Clear()
    $script:LogPos = 0
    $path = Join-Path $script:LogDir $logSources[[string]$logCombo.SelectedItem]
    if (Test-Path $path) {
        $length = (Get-Item $path).Length
        if ($length -gt 12000) { $script:LogPos = $length - 12000 }
    }
    else { Add-ConsoleText $logView "Лог пока пуст.`n" $ColMuted }
}
$logCombo.Add_SelectedIndexChanged({ Reset-LogView })

# ---------------------------------------------------------------- страница: обновления
$pUpdates = New-Table @(70, 178, 30, "*", 56)
$pUpdates.Controls.Add((New-Heading "Обновления" "Код сайта берётся из git-репозитория"), 0, 0)

$cardVersion = New-Panel $ColCard
$cardVersion.Dock = "Fill"
$cardVersion.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 12)
$script:UpdateValues = @{}
$uy = 16
foreach ($name in @("Версия", "Ветка", "Репозиторий", "Статус")) {
    $k = New-Label $name 10 $ColMuted
    $k.Location = New-Object Drawing.Point(22, $uy)
    $v = New-Label "-" 10 $ColInk
    $v.Location = New-Object Drawing.Point(150, $uy)
    $cardVersion.Controls.AddRange(@($k, $v))
    $script:UpdateValues[$name] = $v
    $uy += 30
}
$chkAuto = New-Object Windows.Forms.CheckBox
$chkAuto.Text = "Проверять обновления автоматически (раз в 30 минут)"
$chkAuto.ForeColor = $ColMuted
$chkAuto.AutoSize = $true
$chkAuto.Location = New-Object Drawing.Point(22, 140)
$chkAuto.Checked = [bool](Get-Settings).autoCheck
$chkAuto.Add_CheckedChanged({ Save-Settings ([ordered]@{ autoCheck = [bool]$chkAuto.Checked }) })
$cardVersion.Controls.Add($chkAuto)
$pUpdates.Controls.Add($cardVersion, 0, 1)

$lblCommits = New-Label "Что изменится после обновления" 9.5 $ColMuted
$lblCommits.Margin = New-Object Windows.Forms.Padding(2, 4, 0, 0)
$pUpdates.Controls.Add($lblCommits, 0, 2)

$commitList = New-Object Windows.Forms.ListBox
$commitList.Dock = "Fill"
$commitList.BackColor = New-Color 14 14 16
$commitList.ForeColor = $ColInk
$commitList.BorderStyle = "None"
$commitList.Font = New-Object Drawing.Font("Consolas", 10)
$commitList.Add_HandleCreated({ Set-DarkScroll $this })
$pUpdates.Controls.Add($commitList, 0, 3)

$updBar = New-Object Windows.Forms.FlowLayoutPanel
$updBar.Dock = "Fill"
$updBar.BackColor = $ColBg
$updBar.Padding = New-Object Windows.Forms.Padding(0, 12, 0, 0)
$btnCheck = New-Button "Проверить сейчас" "secondary" 170
$btnUpdate = New-Button "Обновить и перезапустить" "primary" 240
$updBar.Controls.AddRange(@($btnCheck, $btnUpdate))
$pUpdates.Controls.Add($updBar, 0, 4)

# Если папка не подключена к git - вместо версии показываем форму подключения.
$cardConnect = New-Panel $ColCard
$cardConnect.Dock = "Fill"
$cardConnect.Visible = $false
$cardConnect.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 12)
$cLbl = New-Label "Папка не подключена к git. Укажите репозиторий, из которого сайт будет обновляться." 10 $ColYellow
$cLbl.Location = New-Object Drawing.Point(22, 16)
$cUrlLbl = New-Label "Адрес репозитория" 10 $ColMuted
$cUrlLbl.Location = New-Object Drawing.Point(22, 56)
$inUrl = New-Input "https://github.com/ВАШ_АККАУНТ/ВАШ_РЕПОЗИТОРИЙ.git"
$inUrl.Dock = "None"
$inUrl.SetBounds(180, 52, 520, 28)
$cBranchLbl = New-Label "Ветка" 10 $ColMuted
$cBranchLbl.Location = New-Object Drawing.Point(22, 94)
$inBranch = New-Input "main"
$inBranch.Dock = "None"
$inBranch.SetBounds(180, 90, 160, 28)
$btnConnect = New-Button "Подключить" "primary" 150
$btnConnect.Location = New-Object Drawing.Point(180, 128)
$cardConnect.Controls.AddRange(@($cLbl, $cUrlLbl, $inUrl, $cBranchLbl, $inBranch, $btnConnect))
$pUpdates.Controls.Add($cardConnect, 0, 1)
Add-Page "updates" $pUpdates

# ---------------------------------------------------------------- страница: настройки
$pSettings = New-Table @(70, "auto", "auto", "*")
$pSettings.AutoScroll = $true
$pSettings.Controls.Add((New-Heading "Настройки" "Установка, домен, база данных и автозапуск"), 0, 0)

$cardSet = New-Panel $ColCard
$cardSet.Dock = "Top"
$cardSet.Height = 350
$cardSet.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 14)
$grid = New-Table @(50, 50, 50, 50, 50, 44) 2
$grid.Dock = "Fill"
$grid.Padding = New-Object Windows.Forms.Padding(16, 10, 16, 6)
$grid.ColumnStyles.Clear()
[void]$grid.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Absolute", 190)))
[void]$grid.ColumnStyles.Add((New-Object Windows.Forms.ColumnStyle("Percent", 100)))
$inDomain = New-Input "" $false "например lab-3d.pro (пусто - работать по IP)"
$inDb = New-Input "" $true "postgresql://postgres:ПАРОЛЬ@localhost:5432/formnow"
$inAdmin = New-Input "admin"
$inPass = New-Input "" $true "пусто - случайный пароль (или оставить прежний)"
$chkAutostart = New-Object Windows.Forms.CheckBox
$chkAutostart.Text = "Запускать сайт вместе с Windows"
$chkAutostart.ForeColor = $ColInk
$chkAutostart.AutoSize = $true
$chkAutostart.Margin = New-Object Windows.Forms.Padding(0, 10, 0, 0)
$rowsDef = @(
    @("Домен", $inDomain, "пусто - работать по IP (самоподписанный сертификат)"),
    @("База данных (URL)", $inDb, "postgresql://postgres:ПАРОЛЬ@localhost:5432/formnow"),
    @("Логин админа", $inAdmin, "нужен только при первой установке"),
    @("Пароль админа", $inPass, "пусто - создать случайный (или оставить прежний)")
)
$script:SettingHints = @()
$ri = 0
foreach ($def in $rowsDef) {
    $lab = New-Label $def[0] 10 $ColMuted
    $lab.Margin = New-Object Windows.Forms.Padding(0, 10, 0, 0)
    $grid.Controls.Add($lab, 0, $ri)
    $grid.Controls.Add($def[1], 1, $ri)
    $ri++
}
$grid.Controls.Add($chkAutostart, 1, 4)
$hintPanel = New-Label "" 9 $ColMuted
$hintPanel.Text = "Домен: A-запись на IP сервера, порты 80/443 открыты. Пароль админа: не короче 8 символов."
$hintPanel.Margin = New-Object Windows.Forms.Padding(0, 6, 0, 0)
$grid.Controls.Add($hintPanel, 1, 5)
$cardSet.Controls.Add($grid)
$pSettings.Controls.Add($cardSet, 0, 1)

$setBar = New-Object Windows.Forms.FlowLayoutPanel
$setBar.Dock = "Fill"
$setBar.BackColor = $ColBg
$setBar.Height = 56
$btnApply = New-Button "Применить и установить" "primary" 230
$btnUninstall = New-Button "Удалить установку..." "danger" 200
$setBar.Controls.AddRange(@($btnApply, $btnUninstall))
$pSettings.Controls.Add($setBar, 0, 2)
Add-Page "settings" $pSettings

function Load-SettingsValues {
    $config = Read-EnvFile $script:EnvFile
    $inDomain.Text = $config["DEPLOY_DOMAIN"]
    $inDb.Text = $config["DATABASE_URL"]
    $chkAutostart.Checked = [bool](Get-AutostartTask)
    $btnApply.Text = $(if ($config.Count -gt 0) { "Применить" } else { "Установить" })
    $btnUninstall.Enabled = ($config.Count -gt 0)
}

# ---------------------------------------------------------------- страница: очистка
$pCleanup = New-Table @(70, 150, 190, "*")
$pCleanup.Controls.Add((New-Heading "Очистка" "Удаление файлов, которые больше не нужны"), 0, 0)

$cardCache = New-Panel $ColCard
$cardCache.Dock = "Fill"
$cardCache.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 14)
$t1 = New-Label "Кэш сборки и старые логи" 11.5 $ColInk $true
$t1.Location = New-Object Drawing.Point(22, 16)
$d1 = New-Label "Безопасно: всё пересоздаётся само при следующей сборке и работе сервера." 9.5 $ColMuted
$d1.Location = New-Object Drawing.Point(22, 46)
$btnCache = New-Button "Очистить" "secondary" 150
$btnCache.Location = New-Object Drawing.Point(22, 76)
$cardCache.Controls.AddRange(@($t1, $d1, $btnCache))
$pCleanup.Controls.Add($cardCache, 0, 1)

$cardUploads = New-Panel $ColCard
$cardUploads.Dock = "Fill"
$cardUploads.Margin = New-Object Windows.Forms.Padding(0, 0, 0, 14)
$t2 = New-Label "Неиспользуемые загрузки" 11.5 $ColInk $true
$t2.Location = New-Object Drawing.Point(22, 16)
$d2 = New-Label "Модели, которые загрузили для расчёта, но не заказали, и файлы без записи в базе." 9.5 $ColMuted
$d2.Location = New-Object Drawing.Point(22, 46)
$dl = New-Label "Старше (дней):" 10 $ColMuted
$dl.Location = New-Object Drawing.Point(22, 82)
$numDays = New-Object Windows.Forms.NumericUpDown
$numDays.Minimum = 1
$numDays.Maximum = 3650
$numDays.Value = 30
$numDays.BackColor = $ColField
$numDays.ForeColor = $ColInk
$numDays.Font = New-Font 10
$numDays.SetBounds(150, 78, 80, 28)
$btnScan = New-Button "Найти" "secondary" 130
$btnScan.Location = New-Object Drawing.Point(250, 74)
$btnPurge = New-Button "Удалить найденное" "danger" 190
$btnPurge.Location = New-Object Drawing.Point(392, 74)
$btnPurge.Enabled = $false
$lblScan = New-Label "" 10 $ColInk
$lblScan.Location = New-Object Drawing.Point(22, 124)
$cardUploads.Controls.AddRange(@($t2, $d2, $dl, $numDays, $btnScan, $btnPurge, $lblScan))
$pCleanup.Controls.Add($cardUploads, 0, 2)
Add-Page "cleanup" $pCleanup

# ---------------------------------------------------------------- выполнение операций
$script:Queue = New-Object Collections.Queue
$script:Current = $null
$script:OnFinish = $null
$script:Busy = $false

function Set-Busy([bool]$Value) {
    $script:Busy = $Value
    Update-Status
}

function Add-Steps([object[]]$Steps, [scriptblock]$OnFinish = $null) {
    if ($script:Current) { return }
    foreach ($step in $Steps) { $script:Queue.Enqueue($step) }
    $script:OnFinish = $OnFinish
    Set-Busy $true
    Start-NextStep
}

function Start-NextStep {
    if ($script:Queue.Count -eq 0) { Complete-Steps $true; return }
    $step = $script:Queue.Dequeue()
    if ($step.When -and -not (& $step.When)) { Start-NextStep; return }

    New-Item -ItemType Directory -Force -Path $script:LogDir | Out-Null
    $out = Join-Path $script:LogDir "gui-task-out.log"
    $err = Join-Path $script:LogDir "gui-task-err.log"
    Remove-Item $out, $err -ErrorAction SilentlyContinue
    if (-not $step.Silent) { Add-ConsoleText $console ("`n▶ " + $step.Title + "`n") (New-Color 110 190 220) }
    $argLine = '-NoProfile -ExecutionPolicy Bypass -File "{0}" {1}' -f $step.Script, $step.Args
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $argLine -WorkingDirectory $script:Root -PassThru -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err
    [void]$process.Handle
    $script:Current = @{ Step = $step; Process = $process; Out = $out; Err = $err; OutPos = 0; ErrPos = 0; Text = New-Object Text.StringBuilder }
}

function Complete-Steps([bool]$Ok) {
    $script:Queue.Clear()
    $script:Current = $null
    $callback = $script:OnFinish
    $script:OnFinish = $null
    Set-Busy $false
    if ($callback) { & $callback $Ok }
}

function Read-StepOutput($Current) {
    foreach ($name in @("Out", "Err")) {
        $position = [long]$Current["$($name)Pos"]
        $chunk = Read-Appended $Current[$name] ([ref]$position)
        $Current["$($name)Pos"] = $position
        if ($chunk) {
            [void]$Current.Text.Append($chunk)
            if (-not $Current.Step.Silent) { Add-ColoredLines $console $chunk }
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
    $text = $current.Text.ToString()
    $script:Current = $null
    if ($step.OnResult) { & $step.OnResult $text $code }
    if ($code -ne 0 -and -not $step.IgnoreFailure) {
        if (-not $step.Silent) { Add-ConsoleText $console "✖ Операция завершилась с ошибкой.`n" $ColRed }
        $failHook = $step.OnFail
        Complete-Steps $false
        if ($failHook) { & $failHook $text }
        return
    }
    if (-not $step.Silent -and $script:Queue.Count -eq 0) { Add-ConsoleText $console "✔ Готово.`n" $ColAccent }
    Start-NextStep
}

function New-ServerStep([string]$Title, [string]$Arguments, [hashtable]$Extra = @{}) {
    $step = @{ Title = $Title; Script = $script:ServerScript; Args = "$Arguments -NoElevate"; Silent = $false }
    foreach ($key in $Extra.Keys) { $step[$key] = $Extra[$key] }
    return $step
}

# ---------------------------------------------------------------- статус
$script:SiteUrl = ""
$script:DiskTick = 0
$script:DiskText = "-"

function Update-Status {
    $installed = Test-Path $script:EnvFile
    $config = Read-EnvFile $script:EnvFile
    $state = Get-ServerState

    if (-not $installed) {
        $lblState.Text = "○  Не установлен"
        $lblState.ForeColor = $ColYellow
        $lblUptime.Text = "Откройте «Настройки» и нажмите «Установить»"
        $script:SiteUrl = ""
    }
    elseif ($state -and $state.ready) {
        $lblState.Text = "●  Работает"
        $lblState.ForeColor = $ColAccent
        $span = (Get-Date).ToUniversalTime() - (ConvertTo-Utc $state.startedAt)
        $up = if ($span.TotalDays -ge 1) { "{0} д {1} ч" -f [int]$span.TotalDays, $span.Hours } elseif ($span.TotalHours -ge 1) { "{0} ч {1} мин" -f [int]$span.TotalHours, $span.Minutes } else { "{0} мин {1} с" -f $span.Minutes, $span.Seconds }
        $lblUptime.Text = "аптайм $up - продолжает работать, даже если закрыть это окно"
        $script:SiteUrl = $state.url
    }
    elseif ($state) {
        $lblState.Text = "●  Запускается..."
        $lblState.ForeColor = $ColYellow
        $lblUptime.Text = ""
        $script:SiteUrl = $state.url
    }
    else {
        $lblState.Text = "○  Остановлен"
        $lblState.ForeColor = $ColRed
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
        $script:DiskText = "загрузки {0}  ·  логи {1}" -f (Format-Size (Get-FolderSize (Join-Path $script:Root "uploads"))), (Format-Size (Get-FolderSize $script:LogDir))
    }
    $script:FieldValues["Диск"].Text = $script:DiskText

    $running = [bool]$state
    $free = -not $script:Busy
    $btnStart.Enabled = $free -and $installed -and -not $running
    $btnStop.Enabled = $free -and $running
    $btnRestart.Enabled = $free -and $installed
    $btnOpen.Enabled = [bool]$script:SiteUrl
    foreach ($b in @($btnCheck, $btnUpdate, $btnConnect, $btnApply, $btnUninstall, $btnCache, $btnScan, $btnBanner)) { if ($b) { $b.Enabled = $free -and (($b -ne $btnUninstall) -or $installed) } }
    $btnPurge.Enabled = $free -and $script:ScanFound
    $btnUpdate.Enabled = $free -and $installed -and ($script:Git -and $script:Git.isRepo -and $script:Git.behind -gt 0)
    $btnBanner.Enabled = $btnUpdate.Enabled
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
    if (-not $git.isRepo) { $cardVersion.Visible = $false; $cardConnect.Visible = $true; return }

    $version = "{0}  ·  {1}  ·  {2}" -f $git.head, $git.headDate, $git.headMessage
    $script:UpdateValues["Версия"].Text = $version
    $script:UpdateValues["Ветка"].Text = $(if ($git.upstream) { "{0}  →  {1}" -f $git.branch, $git.upstream } else { $git.branch })
    $script:UpdateValues["Репозиторий"].Text = $(if ($git.remote) { $git.remote } else { "не задан" })
    $status = $script:UpdateValues["Статус"]
    if ($git.error) { $status.Text = "нет связи с репозиторием"; $status.ForeColor = $ColRed }
    elseif (-not $git.upstream) { $status.Text = "ветка не привязана к удалённому репозиторию"; $status.ForeColor = $ColYellow }
    elseif ($git.behind -gt 0) { $status.Text = "доступно обновлений: {0}" -f $git.behind; $status.ForeColor = $ColAccent }
    elseif ($git.ahead -gt 0) { $status.Text = "актуально (локально на {0} коммит. новее)" -f $git.ahead; $status.ForeColor = $ColAccent }
    else { $status.Text = "установлена последняя версия"; $status.ForeColor = $ColAccent }

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
$btnCheck.Add_Click({ Start-GitCheck $true })
$btnUpdate.Add_Click({ Start-Update })
$btnBanner.Add_Click({ Start-Update })
$btnConnect.Add_Click({
    $url = $inUrl.Text.Trim()
    $branch = $inBranch.Text.Trim()
    if (-not $url -or $url -like "*ВАШ_*") { [void][Windows.Forms.MessageBox]::Show("Укажите адрес репозитория.", "Подключение", "OK", "Information"); return }
    Add-Steps @((New-ServerStep "Подключение репозитория" ("git-connect {0} {1}" -f (ConvertTo-Arg $url), (ConvertTo-Arg $(if ($branch) { $branch } else { "main" }))))) { param($ok) Start-GitCheck }
    Show-Page "overview"
})

$btnApply.Add_Click({
    $config = Read-EnvFile $script:EnvFile
    $first = ($config.Count -eq 0)
    $db = $inDb.Text.Trim()
    if (-not $db) { [void][Windows.Forms.MessageBox]::Show("Укажите адрес базы данных (PostgreSQL).", "Установка", "OK", "Information"); return }
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
    $steps += @{ Title = "Установка и настройка"; Script = (Join-Path $PSScriptRoot "setup.ps1"); Args = $setupArgs; Silent = $false }
    if ($wantAutostart -ne $hadAutostart) {
        $steps += @{ Title = $(if ($wantAutostart) { "Включение автозапуска" } else { "Выключение автозапуска" }); Script = (Join-Path $PSScriptRoot "install-autostart.ps1"); Args = $(if ($wantAutostart) { "" } else { "-Remove" }); Silent = $false }
    }
    if ($wasRunning -or $first) { $steps += (New-ServerStep "Запуск сервера" "start") }
    Add-Steps $steps { param($ok) $inPass.Text = "" }
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
    $days = [int]$numDays.Value
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
    $days = [int]$numDays.Value
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
    if ($script:CurrentPage -eq "logs") {
        $path = Join-Path $script:LogDir $logSources[[string]$logCombo.SelectedItem]
        $chunk = Read-Appended $path ([ref]$script:LogPos)
        if ($chunk) { Add-ColoredLines $logView $chunk }
    }
})
$statusTimer = New-Object Windows.Forms.Timer
$statusTimer.Interval = 2000
$statusTimer.Add_Tick({ Update-Status })
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
    Show-Page "overview"
    $pump.Start()
    $statusTimer.Start()
    $updateTimer.Start()
    if ([bool](Get-Settings).autoCheck) { Start-GitCheck }
})

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
    foreach ($name in @("overview", "logs", "updates", "settings", "cleanup")) {
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
