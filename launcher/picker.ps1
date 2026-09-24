$ErrorActionPreference = 'Stop'
$data = [Console]::In.ReadToEnd() | ConvertFrom-Json
$selection = $data.items | Select-Object id, label | Out-GridView -Title $data.title -OutputMode Single
if ($selection) { [Console]::WriteLine($selection.id) }
