# Run the script
Clear-Host
$ver = "0.1.0-alpha.rev0"
Write-Host "cliMIDI ($ver)" -ForegroundColor DarkGray

if (!(Test-Path index.js)) {
    Write-Host "The main file used to run cliMIDI is missing!" -ForegroundColor Red
} else {
    Write-Host "(This is required if you don't already have the packages installed)" -ForegroundColor Yellow
    $updatePackages = Read-Host "Do you want to update all of the packages too? (y/n)"
    if ($updatePackages -eq "y") {
        npm i @julusian/midi cli-color jzz jzz-midi-smf midi-player-js easy-file-dialogs strip-json-comments
    }
    Write-Host "Loading Script..." -ForegroundColor White
    Clear-Host
    node --max-old-space-size=4194304 index
}
