$lines = Get-Content 'index.js'
$depth = 0
for ($i = 0; $i -lt $lines.Length; $i++) {
  $l = $lines[$i]
  # Count braces on this line
  $opens = ($l.ToCharArray() | Where-Object { $_ -eq '{' } | Measure-Object).Count
  $closes = ($l.ToCharArray() | Where-Object { $_ -eq '}' } | Measure-Object).Count
  $depth += $opens - $closes
  if ($depth -eq 0 -and $i -gt 184 -and $i -lt 470) {
    Write-Host "depth=0 at line $($i+1): $($lines[$i].Substring(0, [Math]::Min(80, $lines[$i].Length)))"
  }
}
Write-Host "Final depth: $depth"
