# Draws the Lumen app icon (1024x1024 PNG). Regenerate all sizes with:
#   powershell -File scripts/make-icon.ps1 src-tauri/icons/app-icon.png
#   npx tauri icon src-tauri/icons/app-icon.png
#
# Designed to stay readable at tray size (16-32 px) on dark and light
# taskbars: a dark capsule with a thick warm rim, orb and equaliser bars.
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

# Transparent background: just the island. A soft warm halo and a thick
# gradient rim keep the dark capsule visible on dark taskbars.
$cw = 980; $ch = 540; $cx = ($N - $cw) / 2; $cy = ($N - $ch) / 2

for ($i = 18; $i -ge 1; $i--) {
  $grow = $i * 1.2
  $a = [int](4 + (18 - $i) * 1.1)
  $halo = RoundRect ($cx - $grow) ($cy - $grow) ($cw + 2 * $grow) ($ch + 2 * $grow) ($ch / 2 + $grow)
  $g.FillPath((New-Object System.Drawing.SolidBrush (Color $a 247 140 90)), $halo)
}

$rimW = 64
$outer = RoundRect $cx $cy $cw $ch ($ch / 2)
$g.FillPath((Gradient $cx $cy ($cx + $cw) ($cy + $ch) (Color 255 255 196 120) (Color 255 238 82 82)), $outer)
$cap = RoundRect ($cx + $rimW) ($cy + $rimW) ($cw - 2 * $rimW) ($ch - 2 * $rimW) ($ch / 2 - $rimW)
$g.FillPath((New-Object System.Drawing.SolidBrush (Color 255 14 12 16)), $cap)

# Orb on the left.
$orbD = 190; $ox = $cx + 150; $oy = $cy + ($ch - $orbD) / 2
$orbPath = New-Object System.Drawing.Drawing2D.GraphicsPath
$orbPath.AddEllipse($ox, $oy, $orbD, $orbD)
$orb = New-Object System.Drawing.Drawing2D.PathGradientBrush $orbPath
$orb.CenterPoint = New-Object System.Drawing.PointF ($ox + $orbD * 0.35), ($oy + $orbD * 0.35)
$orb.CenterColor = Color 255 255 222 165
$orb.SurroundColors = @(Color 255 245 100 84)
$g.FillEllipse($orb, $ox, $oy, $orbD, $orbD)

# Equaliser bars on the right.
$heights = @(110, 210, 160, 250)
$bw = 54; $gap = 30
$bx = $cx + $cw - 150 - (4 * $bw + 3 * $gap)
$base = $cy + $ch / 2 + 125
for ($k = 0; $k -lt 4; $k++) {
  $h = $heights[$k]; $x = $bx + $k * ($bw + $gap); $y = $base - $h
  $g.FillPath((Gradient $x $y $x $base (Color 255 255 196 120) (Color 255 245 100 84)), (RoundRect $x $y $bw $h ($bw / 2)))
}

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
