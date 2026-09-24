# Терминальный интерфейс: рамки, цвета, чтение клавиш и живой просмотр логов.
# Копия deploy/ui.ps1 из New_Lab_3d - переиспользуем как есть, меняется только заголовок.
$script:UiWidth = 70

function Write-Info([string]$Text) { Write-Host "  $Text" -ForegroundColor Gray }
function Write-Good([string]$Text) { Write-Host "  $Text" -ForegroundColor Green }
# Any printed error marks the run as failed, so server.ps1 exits non-zero and the app can tell.
function Write-Bad([string]$Text) { $script:HadError = $true; Write-Host "  $Text" -ForegroundColor Red }
function Write-Dim([string]$Text) { Write-Host "  $Text" -ForegroundColor DarkGray }

function Write-Rule([string]$Char = "─", [string]$Color = "DarkGray") {
    Write-Host ("  " + ($Char * ($script:UiWidth - 2))) -ForegroundColor $Color
}

function Show-Header {
    $inner = $script:UiWidth - 2
    $left = "ЗАКАЗЫ"
    $right = "управление сервером"
    $gap = [Math]::Max(1, $inner - 4 - $left.Length - $right.Length)
    Write-Host ("  ╔" + ("═" * $inner) + "╗") -ForegroundColor DarkGreen
    Write-Host "  ║  " -NoNewline -ForegroundColor DarkGreen
    Write-Host $left -NoNewline -ForegroundColor Green
    Write-Host (" " * $gap) -NoNewline
    Write-Host $right -NoNewline -ForegroundColor DarkGray
    Write-Host "  ║" -ForegroundColor DarkGreen
    Write-Host ("  ╚" + ("═" * $inner) + "╝") -ForegroundColor DarkGreen
}

function Write-Field([string]$Label, [string]$Value, [string]$Color = "White") {
    Write-Host ("  {0,-12}" -f $Label) -NoNewline -ForegroundColor DarkGray
    Write-Host $Value -ForegroundColor $Color
}

function Write-MenuItem([string]$Key, [string]$Title, [string]$Hint = "") {
    Write-Host "   " -NoNewline
    Write-Host ("[{0}]" -f $Key) -NoNewline -ForegroundColor Green
    Write-Host (" {0,-30}" -f $Title) -NoNewline -ForegroundColor White
    if ($Hint) { Write-Host $Hint -NoNewline -ForegroundColor DarkGray }
    Write-Host ""
}

function Read-MenuKey {
    $key = [Console]::ReadKey($true)
    return $key.KeyChar.ToString()
}

function Wait-AnyKey([string]$Text = "Нажмите любую клавишу...") {
    Write-Host ""
    Write-Host "  $Text" -ForegroundColor DarkGray
    [void][Console]::ReadKey($true)
}

function Read-Confirm([string]$Question) {
    if ($script:AssumeYes) { return $true }
    Write-Host ("  {0} " -f $Question) -NoNewline -ForegroundColor Yellow
    Write-Host "[д/н] " -NoNewline -ForegroundColor DarkGray
    $answer = (Read-MenuKey).ToLower()
    Write-Host $answer
    return ($answer -eq "д" -or $answer -eq "y")
}

function Show-Spinner([scriptblock]$Done, [string]$Text, [int]$TimeoutSeconds = 120) {
    $animate = -not [Console]::IsOutputRedirected
    $frames = @("|", "/", "-", "\")
    $started = Get-Date
    $i = 0
    while (-not (& $Done)) {
        $elapsed = [int]((Get-Date) - $started).TotalSeconds
        if ($elapsed -ge $TimeoutSeconds) { if ($animate) { Write-Host ("`r" + (" " * 78) + "`r") -NoNewline }; return $false }
        if ($animate) { Write-Host ("`r  {0} {1} ({2} с)   " -f $frames[$i % 4], $Text, $elapsed) -NoNewline -ForegroundColor Cyan }
        $i++
        Start-Sleep -Milliseconds 200
    }
    if ($animate) { Write-Host ("`r" + (" " * 78) + "`r") -NoNewline }
    return $true
}

# Показывает хвост файла и новые строки по мере появления. Q / Esc / Ctrl+C - назад в меню.
function Show-LogTail([string]$Path, [string]$Title) {
    Clear-Host
    Write-Host ("  {0}" -f $Title) -NoNewline -ForegroundColor Cyan
    Write-Host "   (Q, Esc или Ctrl+C - назад)" -ForegroundColor DarkGray
    Write-Rule
    if (-not (Test-Path $Path)) { Write-Dim "Лог пока пуст." }

    $previousCtrlC = [Console]::TreatControlCAsInput
    [Console]::TreatControlCAsInput = $true
    $stream = $null
    $reader = $null
    try {
        while ($true) {
            if (-not $stream -and (Test-Path $Path)) {
                $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
                $start = [Math]::Max(0, $stream.Length - 6000)
                [void]$stream.Seek($start, [IO.SeekOrigin]::Begin)
                $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8)
                if ($start -gt 0) { [void]$reader.ReadLine() }
            }
            if ($reader) {
                while ($null -ne ($line = $reader.ReadLine())) {
                    $clean = $line -replace "\x1b\[[0-9;]*[A-Za-z]", ""
                    $color = "Gray"
                    if ($clean -match "error|ошибк|fail|panic") { $color = "Red" }
                    elseif ($clean -match "warn|предупрежд") { $color = "Yellow" }
                    Write-Host "  $clean" -ForegroundColor $color
                }
            }
            while ([Console]::KeyAvailable) {
                $key = [Console]::ReadKey($true)
                $ctrlC = ($key.Key -eq [ConsoleKey]::C) -and (($key.Modifiers -band [ConsoleModifiers]::Control) -ne 0)
                if ($key.Key -eq [ConsoleKey]::Q -or $key.Key -eq [ConsoleKey]::Escape -or $ctrlC) { return }
            }
            Start-Sleep -Milliseconds 250
        }
    }
    finally {
        [Console]::TreatControlCAsInput = $previousCtrlC
        if ($reader) { $reader.Dispose() }
        if ($stream) { $stream.Dispose() }
    }
}
