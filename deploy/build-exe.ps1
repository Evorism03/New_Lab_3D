<#
.SYNOPSIS
  Собирает Lab3D.exe - запускатор окна управления. Использует компилятор C#, встроенный в Windows
  (ничего скачивать не нужно). Собирается один раз; дальше приложение обновляется вместе с кодом.
#>
param([switch]$Quiet)

. (Join-Path $PSScriptRoot "lib.ps1")
Add-Type -AssemblyName System.Drawing

$csc = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw "Не найден компилятор C# (.NET Framework 4). Он входит в Windows 10/11 - проверьте установку .NET." }

# Иконка: тёмная плитка с зелёным треугольником-логотипом, PNG-кадры разных размеров.
function New-IconFrame([int]$Size) {
    $bitmap = New-Object Drawing.Bitmap($Size, $Size)
    $g = [Drawing.Graphics]::FromImage($bitmap)
    $g.SmoothingMode = "AntiAlias"
    $g.Clear([Drawing.Color]::Transparent)
    $green = [Drawing.Color]::FromArgb(127, 191, 127)
    $radius = [int]($Size * 0.22)
    $path = New-Object Drawing.Drawing2D.GraphicsPath
    $rect = New-Object Drawing.Rectangle(0, 0, ($Size - 1), ($Size - 1))
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath((New-Object Drawing.SolidBrush([Drawing.Color]::FromArgb(11, 31, 11))), $path)
    $pen = New-Object Drawing.Pen($green, [Math]::Max(1.2, $Size / 14))
    $pen.LineJoin = "Round"
    $points = @(
        (New-Object Drawing.PointF(($Size * 0.5), ($Size * 0.2))),
        (New-Object Drawing.PointF(($Size * 0.2), ($Size * 0.74))),
        (New-Object Drawing.PointF(($Size * 0.8), ($Size * 0.74)))
    )
    $g.DrawPolygon($pen, [Drawing.PointF[]]$points)
    $dot = [Math]::Max(2.5, $Size * 0.11)
    foreach ($p in $points) { $g.FillEllipse((New-Object Drawing.SolidBrush($green)), ($p.X - $dot / 2), ($p.Y - $dot / 2), $dot, $dot) }
    $g.Dispose()
    $stream = New-Object IO.MemoryStream
    $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    return , $stream.ToArray()
}

$sizes = @(16, 32, 48, 64, 256)
$frames = @()
foreach ($size in $sizes) { $frames += , (New-IconFrame $size) }
$icoPath = Join-Path $PSScriptRoot "app.ico"
$file = [IO.File]::Create($icoPath)
$writer = New-Object IO.BinaryWriter($file)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dimension = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
    $writer.Write([uint16]1); $writer.Write([uint16]32)
    $writer.Write([uint32]$frames[$i].Length); $writer.Write([uint32]$offset)
    $offset += $frames[$i].Length
}
foreach ($frame in $frames) { $writer.Write($frame) }
$writer.Dispose()
$file.Dispose()

$exe = Join-Path $script:Root "Lab3D.exe"
$references = "/reference:System.Windows.Forms.dll"
& $csc /nologo /target:winexe /codepage:65001 "/out:$exe" "/win32icon:$icoPath" "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')" $references (Join-Path $PSScriptRoot "launcher.cs")
if ($LASTEXITCODE -ne 0) { throw "Не удалось собрать Lab3D.exe." }
if (-not $Quiet) { Write-Ok "Готово: $exe" }
