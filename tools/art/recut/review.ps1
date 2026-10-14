param([string]$Set = 'bigfoot/fledgling')
$ErrorActionPreference = 'Stop'
if ($Set -notin @('bigfoot/fledgling','bigfoot/sworn','bigfoot/radiant','bigfoot/mythic')) { throw 'Bigfoot base tiers only' }
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
Push-Location $taskRoot
$tier = $Set.Split('/')[1]
$taskOutput = Join-Path $taskRoot ('art/recut/'+$Set+'/final')
New-Item -ItemType Directory -Force $taskOutput | Out-Null
$taskExitCodes = [ordered]@{}
$env:RIVE_MCP_CHROME = & node --input-type=module -e "import {chromiumFromCheckout} from './tools/art/rive-cli.mjs'; console.log(chromiumFromCheckout());"
function Run-Check([string]$Name, [scriptblock]$Command) {
    & $Command 2>&1 | Out-File -LiteralPath (Join-Path $taskOutput ($Name+'.txt')) -Encoding utf8
    $taskExitCodes[$Name] = $LASTEXITCODE
    Write-Output ($Set+' '+$Name+': exit '+$LASTEXITCODE)
    if ($LASTEXITCODE -ne 0) { throw ($Name+' failed; stop and inspect its output') }
}
try {
    if ((Get-Content art/rig/bigfoot.rig.json -Raw | ConvertFrom-Json).underpaint -ne 0) { throw 'Expected underpaint 0' }
    Run-Check 'A' { & python tools/art/verify.py $Set --fail-fragments }
    Run-Check 'B' { & python tools/art/verify_seams.py $Set }
    Run-Check 'C' { & npm run art:rig:build -- $Set }
    Run-Check 'D' { & npm run art:rig:build -- --check $Set }
    Run-Check 'E' { & npm run art:verify:rig:strict }
    Run-Check 'F' { & node tools/art/verify-rig-rest.mjs bigfoot --tier $tier }
    Run-Check 'G' { & node tools/art/verify-rig-motion.mjs bigfoot --tier $tier }
    foreach ($clip in @('idle','walk','attack')) {
        Run-Check ('H-'+$clip) { & node tools/art/rig-sheet.mjs --clip $clip --tier $tier }
        Copy-Item -LiteralPath ('art/review/rig_'+$clip+'_'+$tier+'.png') -Destination (Join-Path $taskOutput ('sheet-'+$clip+'.png'))
    }
    foreach ($clip in @('walk','attack')) {
        $taskTime = if ($clip -eq 'walk') { '0.083333' } else { '0.333333' }
        & node .rive-mcp/dist/cli.js render ('assets/characters/'+$Set+'/rig.riv') --animation $clip --time $taskTime --width 1400 --background '#1a1a1e' -o (Join-Path $taskOutput ($clip+'.png'))
        if ($LASTEXITCODE -ne 0) { throw 'Frame render failed' }
    }
    Run-Check 'audit' { & python tools/art/recut/evidence.py $Set }
} finally {
    $taskExitCodes | ConvertTo-Json | Out-File -LiteralPath (Join-Path $taskOutput 'exit-codes.json') -Encoding utf8
    Pop-Location
}
