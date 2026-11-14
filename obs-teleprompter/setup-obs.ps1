# Настройка OBS Studio 33 + телесуфлер
# Запуск: двойной клик по run-setup.bat (или: powershell -ExecutionPolicy Bypass -File setup-obs.ps1)
# Совместим с Windows PowerShell 5.1 и PowerShell 7+.
[CmdletBinding()]
param(
    [string]$RecEncoder = 'jim_nvenc',     # NVIDIA NVENC H.264 (в OBS 31+ новый id: obs_nvenc_h264_tex)
    [string]$RecFormat  = 'hybrid_mp4',    # hybrid_mp4 не теряет запись при сбое; можно 'mp4'
    [switch]$NoLaunch                      # не запускать OBS и суфлер после настройки
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$Report = New-Object System.Collections.Generic.List[string]
function Log([string]$msg) { $Report.Add($msg); Write-Host "  - $msg" }
function Step([string]$msg) { Write-Host ""; Write-Host "== $msg" -ForegroundColor Cyan }

$ObsRoot   = Join-Path $env:APPDATA 'obs-studio'
$BasicDir  = Join-Path $ObsRoot 'basic'
$Profiles  = Join-Path $BasicDir 'profiles'
$Scenes    = Join-Path $BasicDir 'scenes'
if (-not (Test-Path $Profiles) -or -not (Test-Path $Scenes)) {
    throw "Не найдены папки OBS в $BasicDir. Запустите OBS хотя бы один раз."
}

# ---------------------------------------------------------------- 1. Закрыть OBS + бэкап
Step '1. Завершение OBS и резервная копия'
$obs = Get-Process -Name obs64 -ErrorAction SilentlyContinue
$ObsExe = $null
if ($obs) {
    try { $ObsExe = $obs[0].Path } catch {}
    foreach ($p in $obs) { [void]$p.CloseMainWindow() }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Process -Name obs64 -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
    $left = Get-Process -Name obs64 -ErrorAction SilentlyContinue
    if ($left) { $left | Stop-Process -Force; Start-Sleep -Seconds 2; Log 'obs64.exe завершён принудительно (не закрылся за 15 с)' }
    else { Log 'obs64.exe корректно закрыт' }
} else { Log 'obs64.exe не был запущен' }

$stamp  = Get-Date -Format 'yyyyMMdd_HHmmss'
$Backup = Join-Path $ObsRoot "backup_$stamp"
New-Item -ItemType Directory -Path $Backup -Force | Out-Null
Copy-Item $Profiles (Join-Path $Backup 'profiles') -Recurse -Force
Copy-Item $Scenes   (Join-Path $Backup 'scenes')   -Recurse -Force
Log "Бэкап profiles и scenes: $Backup"

# ---------------------------------------------------------------- Вспомогательные функции INI
function Read-IniValue([string]$path, [string]$section, [string]$key) {
    if (-not (Test-Path $path)) { return $null }
    $cur = ''
    foreach ($line in [IO.File]::ReadAllLines($path)) {
        $t = $line.Trim()
        if ($t -match '^\[(.+)\]$') { $cur = $Matches[1]; continue }
        if ($cur -eq $section -and $t -match '^([^=]+)=(.*)$' -and $Matches[1].Trim() -eq $key) { return $Matches[2] }
    }
    return $null
}

function Set-IniValues([string]$path, [System.Collections.Specialized.OrderedDictionary]$values) {
    # $values: section -> ordered(key -> value). Сохраняет порядок/комментарии, правит на месте.
    $lines = New-Object System.Collections.Generic.List[string]
    if (Test-Path $path) { $lines.AddRange([string[]][IO.File]::ReadAllLines($path)) }
    foreach ($section in $values.Keys) {
        $kv = $values[$section]
        $start = -1
        for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -eq "[$section]") { $start = $i; break } }
        if ($start -lt 0) {
            if ($lines.Count -gt 0 -and $lines[$lines.Count-1].Trim() -ne '') { $lines.Add('') }
            $lines.Add("[$section]"); $start = $lines.Count - 1
        }
        $end = $lines.Count
        for ($i = $start + 1; $i -lt $lines.Count; $i++) { if ($lines[$i].Trim() -match '^\[.+\]$') { $end = $i; break } }
        foreach ($key in $kv.Keys) {
            $newLine = "$key=$($kv[$key])"; $found = $false
            for ($i = $start + 1; $i -lt $end; $i++) {
                if ($lines[$i] -match '^\s*([^=]+?)\s*=' -and $Matches[1] -eq $key) {
                    if ($lines[$i] -ne $newLine) { Log "[$section] $key : '$(($lines[$i] -split '=',2)[1])' -> '$($kv[$key])'" }
                    $lines[$i] = $newLine; $found = $true; break
                }
            }
            if (-not $found) {
                # вставить перед хвостовыми пустыми строками секции
                $ins = $end
                while ($ins -gt $start + 1 -and $lines[$ins-1].Trim() -eq '') { $ins-- }
                $lines.Insert($ins, $newLine); $end++
                Log "[$section] $key = $($kv[$key]) (добавлено)"
            }
        }
    }
    [IO.File]::WriteAllLines($path, $lines.ToArray(), $Utf8NoBom)
}

# Где OBS хранит активный профиль/коллекцию: user.ini (OBS 31+) или global.ini (старые)
$IniCandidates = @((Join-Path $ObsRoot 'user.ini'), (Join-Path $ObsRoot 'global.ini'))
function Get-ActiveSetting([string]$key) {
    foreach ($f in $IniCandidates) { $v = Read-IniValue $f 'Basic' $key; if ($v) { return $v } }
    return $null
}

# ---------------------------------------------------------------- 2. Профиль
Step '2. Профиль (basic.ini + recordEncoder.json)'
$profileDir = $null
$pd = Get-ActiveSetting 'ProfileDir'
if ($pd -and (Test-Path (Join-Path $Profiles $pd))) { $profileDir = Join-Path $Profiles $pd }
if (-not $profileDir) {
    foreach ($n in @('Unnamed','Untitled','Без_названия','Без названия')) {
        $c = Join-Path $Profiles $n; if (Test-Path (Join-Path $c 'basic.ini')) { $profileDir = $c; break }
    }
}
if (-not $profileDir) {
    $latest = Get-ChildItem $Profiles -Recurse -Filter basic.ini | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest) { $profileDir = $latest.DirectoryName }
}
if (-not $profileDir) { throw "Не найден ни один профиль с basic.ini в $Profiles" }
$basicIni = Join-Path $profileDir 'basic.ini'
Log "Активный профиль: $profileDir"

$ini = [ordered]@{}
$ini['Output'] = [ordered]@{ 'Mode' = 'Advanced' }
$ini['AdvOut'] = [ordered]@{
    'RecType'        = 'Standard'
    'RecFormat2'     = $RecFormat
    'RecEncoder'     = $RecEncoder
    'FFOutputToFile' = 'true'
}
$ini['Video'] = [ordered]@{
    'BaseCX' = '1920'; 'BaseCY' = '1080'
    'OutputCX' = '1920'; 'OutputCY' = '1080'
    'FPSType' = '0'; 'FPSCommon' = '60'
}
$ini['Audio'] = [ordered]@{ 'ChannelSetup' = 'Stereo'; 'SampleRate' = '48000' }
Set-IniValues $basicIni $ini

$encJson = [ordered]@{ rate_control = 'CQP'; cqp = 18; preset2 = 'p5'; tune = 'hq'; multipass = 'qres'; profile = 'high' }
$encPath = Join-Path $profileDir 'recordEncoder.json'
if (Test-Path $encPath) {
    try {
        $old = [IO.File]::ReadAllText($encPath) | ConvertFrom-Json
        foreach ($p in $old.PSObject.Properties) { if (-not $encJson.Contains($p.Name)) { $encJson[$p.Name] = $p.Value } }
    } catch {}
}
[IO.File]::WriteAllText($encPath, ($encJson | ConvertTo-Json -Depth 10), $Utf8NoBom)
Log "recordEncoder.json: CQP 18, preset p5, tune hq, multipass qres, profile high"

# ---------------------------------------------------------------- 3. Коллекция сцен
Step '3. Коллекция сцен (аудио, фильтры, веб-камера)'
$sceneFile = $null
$sf = Get-ActiveSetting 'SceneCollectionFile'
if ($sf) { $c = Join-Path $Scenes "$sf.json"; if (Test-Path $c) { $sceneFile = $c } }
if (-not $sceneFile) {
    $sceneFile = Get-ChildItem $Scenes -Filter *.json | Where-Object { $_.Name -notmatch '\.bak$' } |
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $sceneFile) { throw "Не найдена коллекция сцен в $Scenes" }
Log "Коллекция сцен: $sceneFile"

$doc = [IO.File]::ReadAllText($sceneFile, [Text.Encoding]::UTF8) | ConvertFrom-Json

function Set-Prop($obj, [string]$name, $value) {
    if ($obj.PSObject.Properties[$name]) { $obj.$name = $value }
    else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value -Force }
}
function Ensure-Obj($obj, [string]$name) {
    if (-not $obj.PSObject.Properties[$name] -or $null -eq $obj.$name) { Set-Prop $obj $name ([pscustomobject]@{}) }
    return $obj.$name
}

# все источники: массив sources + глобальные устройства (DesktopAudioDevice1, AuxAudioDevice1 ...)
$all = New-Object System.Collections.Generic.List[object]
if ($doc.PSObject.Properties['sources']) { foreach ($s in $doc.sources) { $all.Add([pscustomobject]@{ src = $s; kind = '' }) } }
foreach ($p in @($doc.PSObject.Properties)) {
    if ($p.Name -match '^(Desktop|Aux)AudioDevice\d$' -and $p.Value -and $p.Value.PSObject.Properties['id']) {
        $all.Add([pscustomobject]@{ src = $p.Value; kind = $Matches[1] })
    }
}

$reMic     = 'Mic/Aux|Микр|fifine'
$reDesktop = 'Desktop Audio|Рабочий стол'
function VidName($s) {
    if ($s.settings -and $s.settings.PSObject.Properties['video_device_id']) { return [string]$s.settings.video_device_id }
    return ''
}

function New-Filter([string]$id, [string]$name, $settings) {
    [pscustomobject][ordered]@{
        prev_ver = 0; name = $name; uuid = [guid]::NewGuid().ToString(); id = $id; versioned_id = $id
        settings = [pscustomobject]$settings; mixers = 0; sync = 0; flags = 0; volume = 1.0; balance = 0.5
        enabled = $true; muted = $false; 'push-to-mute' = $false; 'push-to-mute-delay' = 0
        'push-to-talk' = $false; 'push-to-talk-delay' = 0; hotkeys = [pscustomobject]@{}
        deinterlace_mode = 0; deinterlace_field_order = 0; monitoring_type = 0; private_settings = [pscustomobject]@{}
    }
}

$wanted = @(
    @{ id = 'noise_suppress_filter_v2'; name = 'Noise Suppression'; s = [ordered]@{ method = 'rnnoise' } },
    @{ id = 'noise_gate_filter';        name = 'Noise Gate';        s = [ordered]@{ open_threshold = -26.0; close_threshold = -32.0 } },
    @{ id = 'basic_eq_filter';          name = '3-Band Equalizer';  s = [ordered]@{ high = 1.5; mid = -2.0; low = 0.0 } },
    @{ id = 'compressor_filter';        name = 'Compressor';        s = [ordered]@{ ratio = 4.0; threshold = -18.0; attack_time = 6; release_time = 60; output_gain = 2.0 } }
)

$micCount = 0; $deskCount = 0; $camCount = 0
$dshow = @($all | Where-Object { $_.src.id -eq 'dshow_input' })
$wantedIds = @($wanted | ForEach-Object { $_.id })

foreach ($entry in $all) {
    $s = $entry.src
    $name = [string]$s.name
    $isGlobalDesk = $entry.kind -eq 'Desktop'
    $isGlobalAux  = $entry.kind -eq 'Aux'

    # --- Микрофон
    if ($s.id -eq 'wasapi_input_capture' -or $isGlobalAux -or ($name -match $reMic -and $s.id -ne 'dshow_input')) {
        $micCount++
        Set-Prop $s 'monitoring_type' 0
        Set-Prop $s 'volume' 0.7
        Set-Prop $s 'muted' $false
        $existing = @(); if ($s.PSObject.Properties['filters'] -and $s.filters) { $existing = @($s.filters) }
        $ordered = New-Object System.Collections.Generic.List[object]
        foreach ($w in $wanted) {
            $f = $existing | Where-Object { $_.id -eq $w.id -or $_.versioned_id -eq $w.id } | Select-Object -First 1
            if ($f) {
                $st = Ensure-Obj $f 'settings'
                foreach ($k in $w.s.Keys) { Set-Prop $st $k $w.s[$k] }
                Set-Prop $f 'enabled' $true
                $tag = 'обновлён'
            } else { $f = New-Filter $w.id $w.name $w.s; $tag = 'добавлен' }
            $ordered.Add($f)
            Log "Микрофон '$name': фильтр $($w.id) $tag"
        }
        foreach ($f in $existing) { if (-not ($wantedIds -contains $f.id)) { $ordered.Add($f) } }  # прочие фильтры сохраняются после
        Set-Prop $s 'filters' ([object[]]$ordered.ToArray())
        Log "Микрофон '$name': monitoring_type=0 (прослушивание выкл.), volume=0.7 (~-3 дБ)"
        continue
    }

    # --- Звук рабочего стола
    if ($s.id -eq 'wasapi_output_capture' -or $isGlobalDesk -or $name -match $reDesktop) {
        $deskCount++
        Set-Prop $s 'muted' $true; Set-Prop $s 'monitoring_type' 0
        Log "Звук рабочего стола '$name': muted=true, monitoring_type=0"
        continue
    }

    # --- Устройство захвата видео / веб-камера
    if ($s.id -eq 'dshow_input') {
        $camCount++
        Set-Prop $s 'muted' $true; Set-Prop $s 'monitoring_type' 0
        Log "Видео-захват '$name': muted=true (звук камеры выкл.), monitoring_type=0"
        $isKiyo = ((VidName $s) -match 'kiyo|razer') -or ($name -match 'kiyo|razer') -or ($dshow.Count -eq 1)
        if ($isKiyo) {
            $st = Ensure-Obj $s 'settings'
            Set-Prop $st 'res_type' 1
            Set-Prop $st 'resolution' '1920x1080'
            Set-Prop $st 'frame_interval' 166666
            Set-Prop $st 'color_space' '709'
            Set-Prop $st 'color_range' 'full'
            Set-Prop $st 'buffering' $false
            if ($st.PSObject.Properties['video_format']) { $vf = "оставлен текущий ($($st.video_format))" } else { $vf = 'не задан (авто: камера сама выберет рабочий формат)' }
            Log "Камера '$name': 1920x1080 @60 (166666), res_type=1, color 709/full, buffering=false, video_format $vf"
        }
    }
}

if ($micCount -eq 0)  { Log 'ВНИМАНИЕ: источник микрофона не найден — фильтры не добавлены' }
if ($deskCount -eq 0) { Log 'Источник "Рабочий стол" не найден (пропущено)' }
if ($camCount -eq 0)  { Log 'Источник dshow_input не найден (пропущено)' }

$json = $doc | ConvertTo-Json -Depth 100
[void]($json | ConvertFrom-Json)  # проверка валидности перед записью
[IO.File]::WriteAllText($sceneFile, $json, $Utf8NoBom)
Log 'JSON коллекции сцен сохранён (UTF-8 без BOM), валидность проверена'

# ---------------------------------------------------------------- 4. Телесуфлер
Step '4. Телесуфлер'
$Desktop = [Environment]::GetFolderPath('Desktop')
$srcHtml = Join-Path $PSScriptRoot 'teleprompter.html'
$dstHtml = Join-Path $Desktop 'teleprompter.html'
if (-not (Test-Path $srcHtml)) { throw "Не найден $srcHtml рядом со скриптом" }
Copy-Item $srcHtml $dstHtml -Force
Log "teleprompter.html скопирован: $dstHtml"

# ---------------------------------------------------------------- 5. Запуск
Step '5. Запуск OBS и телесуфлера'
if (-not $NoLaunch) {
    if (-not $ObsExe -or -not (Test-Path $ObsExe)) {
        $cands = @()
        foreach ($rk in 'HKLM:\SOFTWARE\OBS Studio','HKLM:\SOFTWARE\WOW6432Node\OBS Studio') {
            try { $v = (Get-ItemProperty $rk -ErrorAction Stop).'(default)'; if ($v) { $cands += (Join-Path $v 'bin\64bit\obs64.exe') } } catch {}
        }
        $cands += "$env:ProgramFiles\obs-studio\bin\64bit\obs64.exe"
        $cands += "${env:ProgramFiles(x86)}\obs-studio\bin\64bit\obs64.exe"
        $ObsExe = $cands | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    }
    if ($ObsExe) {
        Start-Process -FilePath $ObsExe -WorkingDirectory (Split-Path $ObsExe)   # OBS требует рабочую папку bin\64bit
        Log "OBS запущен: $ObsExe"
    } else { Log 'OBS не найден автоматически — запустите вручную' }

    $browser = $null
    foreach ($app in 'msedge.exe','chrome.exe') {
        foreach ($root in 'HKLM:','HKCU:') {
            try { $v = (Get-ItemProperty "$root\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$app" -ErrorAction Stop).'(default)'; if ($v -and (Test-Path $v)) { $browser = $v; break } } catch {}
        }
        if ($browser) { break }
    }
    if (-not $browser) {
        $browser = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
                     "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") |
                   Where-Object { Test-Path $_ } | Select-Object -First 1
    }
    if ($browser) {
        $url = 'file:///' + ($dstHtml -replace '\\','/')
        # отдельный профиль браузера, чтобы размер окна применился даже если Edge/Chrome уже открыт
        $prof = Join-Path $env:LOCALAPPDATA 'TeleprompterBrowserProfile'
        $bargs = @("--app=`"$url`"", '--window-size=520,260', '--window-position=700,0', "--user-data-dir=`"$prof`"", '--no-first-run', '--no-default-browser-check')
        Start-Process -FilePath $browser -ArgumentList $bargs
        Log "Телесуфлер открыт в компактном окне 520x260: $(Split-Path $browser -Leaf)"
    } else { Log 'Edge/Chrome не найден — откройте teleprompter.html вручную' }
}

# ---------------------------------------------------------------- Отчёт
$reportPath = Join-Path $Backup 'report.txt'
[IO.File]::WriteAllLines($reportPath, $Report.ToArray(), $Utf8NoBom)
Write-Host ""
Write-Host "Готово. Отчёт: $reportPath" -ForegroundColor Green
Write-Host "Откат: закройте OBS и скопируйте папки из $Backup обратно в $BasicDir" -ForegroundColor Yellow
