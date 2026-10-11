# Draws the Lumen app icon (1024x1024 PNG). Regenerate all sizes with:
#   powershell -File scripts/make-icon.ps1 src-tauri/icons/app-icon.png
#   npx tauri icon src-tauri/icons/app-icon.png
#
# Designed to stay readable at tray size (16-32 px): a warm tile in the glow
# colours with a big black capsule, orb and equaliser bars.
param([string]$out)
Add-Type -AssemblyName System.Drawing
$N = 1024
$bmp = New-Object System.Drawing.Bitmap $N, $N
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.Clear([System.Drawing.Color]::Transparent)

function Color($a, $r, $gr, $b) { [System.Drawing.Color]::FromArgb($a, $r, $gr, $b) }
function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
function Gradient($x1, $y1, $x2, $y2, $c1, $c2) {
  New-Object System.Drawing.Drawing2D.LinearGradientBrush((New-Object System.Drawing.PointF $x1, $y1), (New-Object System.Drawing.PointF $x2, $y2), $c1, $c2)
}

# Warm tile: amber top-left to coral bottom-right.
$tile = RoundRect 24 24 976 976 230
$g.FillPath((Gradient 0 0 $N $N (Color 255 255 196 120) (Color 255 238 82 82)), $tile)
$g.SetClip($tile)

# Soft light at the top for a bit of depth.
$g.FillEllipse((Gradient 0 -300 0 500 (Color 90 255 255 255) (Color 0 255 255 255)), -200, -420, 1424, 900)

# Big black capsule.
$cw = 820; $ch = 380; $cx = ($N - $cw) / 2; $cy = ($N - $ch) / 2 + 10
$cap = RoundRect $cx $cy $cw $ch ($ch / 2)
$g.FillPath((New-Object System.Drawing.SolidBrush (Color 255 14 12 16)), $cap)

# Orb on the left.
$orbD = 170; $ox = $cx + 105; $oy = $cy + ($ch - $orbD) / 2
$orbPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$orbPath.AddEllipse($ox, $oy, $orbD, $orbD)
$orb = New-Object System.Drawing.Drawing2D.PathGradientBrush $orbPath
$orb.CenterPoint = New-Object System.Drawing.PointF ($ox + $orbD * 0.35), ($oy + $orbD * 0.35)
$orb.CenterColor = Color 255 255 222 165
$orb.SurroundColors = @(Color 255 245 100 84)
$g.FillEllipse($orb, $ox, $oy, $orbD, $orbD)

# Equaliser bars on the right.
$heights = @(110, 200, 150, 240)
$bw = 52; $gap = 30
$bx = $cx + $cw - 110 - (4 * $bw + 3 * $gap)
$base = $cy + $ch / 2 + 120
for ($k = 0; $k -lt 4; $k++) {
  $h = $heights[$k]; $x = $bx + $k * ($bw + $gap); $y = $base - $h
  $g.FillPath((Gradient $x $y $x $base (Color 255 255 196 120) (Color 255 245 100 84)), (RoundRect $x $y $bw $h ($bw / 2)))
}

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
