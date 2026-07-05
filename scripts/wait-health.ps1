param(
  [Parameter(Mandatory = $true)]
  [string] $Url,
  [int] $Attempts = 20
)

for ($i = 0; $i -lt $Attempts; $i += 1) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 1
    if ($response.StatusCode -eq 200) {
      exit 0
    }
  } catch {
  }
  Start-Sleep -Seconds 1
}

exit 1
