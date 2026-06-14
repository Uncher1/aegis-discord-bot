$killed = @()
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine -like '*src/index.ts*' } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      $killed += $_.ProcessId
    } catch {}
  }
if ($killed.Count -gt 0) {
  Write-Output ("[kill-bot] " + $killed.Count + " instance(s) tuee(s) : " + ($killed -join ', '))
} else {
  Write-Output "[kill-bot] aucune instance en cours"
}
