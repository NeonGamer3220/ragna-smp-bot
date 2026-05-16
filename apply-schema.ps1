$headers = @{
  'apikey'        = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdXVkcHVyZXJjaXNweG90cGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4OTIxNzUsImV4cCI6MjA5NDQ2ODE3NX0.RXObcpAVEpP6sJadBwlLgpMjEK8-U3ArzBX14h4ca8Y'
  'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZtdXVkcHVyZXJjaXNweG90cGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4OTIxNzUsImV4cCI6MjA5NDQ2ODE3NX0.RXObcpAVEpP6sJadBwlLgpMjEK8-U3ArzBX14h4ca8Y'
}

$body = @{
  query = [System.IO.File]::ReadAllText("$PWD/supabase-schema.sql")
} | ConvertTo-Json -Compress

try {
  $r = Invoke-RestMethod -Uri 'https://vmuudpurercispxotpdi.supabase.co/rest/v1/rpc' -Method POST -Headers $headers -Body $body -ContentType 'application/json'
  Write-Host "OK:" ($r | ConvertTo-Json -Depth 5)
} catch {
  $code = $_.Exception.Response.StatusCode
  $reader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
  $err = $reader.ReadToEnd()
  Write-Host "HTTP $code : $err"
}
