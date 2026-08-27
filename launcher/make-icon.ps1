# Generates launcher\kumondb.ico — a simple generated app icon with "Kumon" text.
# Re-run this any time to regenerate (e.g. after changing colors/text below).

Add-Type -AssemblyName System.Drawing

$sizes = @(256, 128, 64, 48, 32, 16)
$outDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$icoPath = Join-Path $outDir "kumondb.ico"

function New-IconBitmap([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    # Rounded-square background with a blue -> teal gradient.
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $radius = [int]($size * 0.22)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 17, 110, 209),
        [System.Drawing.Color]::FromArgb(255, 13, 168, 176),
        45
    )
    $g.FillPath($brush, $path)

    # Thin lighter border for a bit of depth.
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 255, 255, 255), [Math]::Max(1, $size * 0.02))
    $g.DrawPath($pen, $path)

    if ($size -ge 32) {
        # "Kumon" wordmark, centered, sized to fit the rounded square.
        $fontSize = [Math]::Max(6, [int]($size * 0.24))
        $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center

        $g.DrawString("Kumon", $font, $textBrush, [float]($size / 2), [float]($size * 0.42), $format)

        $subFontSize = [Math]::Max(5, [int]($size * 0.12))
        $subFont = New-Object System.Drawing.Font("Segoe UI", $subFontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(230, 255, 255, 255))
        $g.DrawString("DB", $subFont, $subBrush, [float]($size / 2), [float]($size * 0.72), $format)
    }
    else {
        # Too small for legible text — just draw a bold "K" mark instead.
        $fontSize = [int]($size * 0.62)
        $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
        $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
        $format = New-Object System.Drawing.StringFormat
        $format.Alignment = [System.Drawing.StringAlignment]::Center
        $format.LineAlignment = [System.Drawing.StringAlignment]::Center
        $g.DrawString("K", $font, $textBrush, [float]($size / 2), [float]($size / 2) + 1, $format)
    }

    $g.Dispose()
    return $bmp
}

# Build one PNG (in-memory) per size, then hand-assemble a .ico container.
# Modern .ico files can embed PNG-compressed frames directly, which keeps
# this script simple (no legacy BMP/AND-mask encoding needed).
$pngBytesBySize = @{}
foreach ($size in $sizes) {
    $bmp = New-IconBitmap $size
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesBySize[$size] = $ms.ToArray()
    $ms.Dispose()
    $bmp.Dispose()
}

$fs = New-Object System.IO.FileStream($icoPath, [System.IO.FileMode]::Create)
$writer = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header: reserved(2)=0, type(2)=1 (icon), count(2)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]$sizes.Count)

$headerSize = 6
$entrySize = 16
$offset = $headerSize + ($entrySize * $sizes.Count)

foreach ($size in $sizes) {
    $bytes = $pngBytesBySize[$size]
    $dim = if ($size -ge 256) { 0 } else { $size }  # 0 means 256 in ICO format
    $writer.Write([Byte]$dim)      # width
    $writer.Write([Byte]$dim)      # height
    $writer.Write([Byte]0)         # color palette
    $writer.Write([Byte]0)         # reserved
    $writer.Write([UInt16]1)       # color planes
    $writer.Write([UInt16]32)      # bits per pixel
    $writer.Write([UInt32]$bytes.Length)
    $writer.Write([UInt32]$offset)
    $offset += $bytes.Length
}

foreach ($size in $sizes) {
    $writer.Write($pngBytesBySize[$size])
}

$writer.Flush()
$writer.Close()
$fs.Close()

Write-Host "Icon written to $icoPath"
