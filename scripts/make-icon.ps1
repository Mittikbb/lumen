# Draws the Lumen app icon (1024x1024 PNG). Regenerate all sizes with:
#   powershell -File scripts/make-icon.ps1 src-tauri/icons/app-icon.png
#   npx tauri icon src-tauri/icons/app-icon.png
#
# Minimal and flat: the dark island with a single warm "light" on a
# transparent background. A thin light rim keeps it visible on dark taskbars.
param([string]$out)
Add-Type -AssemblyName System.Drawing
$N = 1024
$bmp = New-Object System.Drawing.Bitmap $N, $N
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function Color($r, $gr, $b) { [System.Drawing.Color]::FromArgb(255, $r, $gr, $b) }
function Pill([float]$x, [float]$y, [float]$w, [float]$h) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $p.AddArc($x, $y, $h, $h, 90, 180)
  $p.AddArc($x + $w - $h, $y, $h, $h, 270, 180)
  $p.CloseFigure()
  return $p
}

# Capsule: 56x24 on a 64 grid, scaled to 1024.
$rim = 30
$w = 896 - $rim; $h = 384 - $rim
$x = ($N - $w) / 2; $y = ($N - $h) / 2
$pill = Pill $x $y $w $h
$g.FillPath((New-Object System.Drawing.SolidBrush (Color 20 20 24)), $pill)
$g.DrawPath((New-Object System.Drawing.Pen (Color 74 74 84), $rim), $pill)

# The light.
$d = 168
$g.FillEllipse((New-Object System.Drawing.SolidBrush (Color 245 137 79)), ($x + $h / 2 - $d / 2 + 20), ($N / 2 - $d / 2), $d, $d)

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
