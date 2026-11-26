function Show-KumonLaunchError {
    param([string]$Stage, [string]$ProjectDir, [string]$Detail)
    $labels = @{ reuse = 'เปิดหน้าต่างของโปรแกรมที่ทำงานอยู่ไม่สำเร็จ'; dependencies = 'ส่วนประกอบโปรแกรมยังไม่ครบ'; start = 'เปิดโปรแกรมไม่สำเร็จ' }
    $message = $labels[$Stage]
    if (-not $message) { $message = $labels.start }
    $diagnostic = "KumonDB`r`nComputer: $env:COMPUTERNAME`r`nFolder: $ProjectDir`r`nStage: $Stage`r`n$Detail"
    try {
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $form = New-Object System.Windows.Forms.Form
        $form.Text = 'KumonDB - เปิดโปรแกรมไม่สำเร็จ'
        $form.Width = 620; $form.Height = 360; $form.StartPosition = 'CenterScreen'
        $form.TopMost = $true
        $heading = New-Object System.Windows.Forms.Label
        $heading.Text = "$message`r`nลองเปิดอีกครั้ง หรือคัดลอกรายละเอียดส่งผู้ดูแล หากมีงานค้างให้ตรวจงานก่อนรีสตาร์ต"
        $heading.SetBounds(16, 12, 570, 58)
        $details = New-Object System.Windows.Forms.TextBox
        $details.Multiline = $true; $details.ReadOnly = $true; $details.ScrollBars = 'Vertical'; $details.Text = $diagnostic
        $details.SetBounds(16, 78, 570, 180)
        $copy = New-Object System.Windows.Forms.Button
        $copy.Text = 'คัดลอกรายละเอียด'; $copy.SetBounds(280, 276, 170, 32)
        $copy.Add_Click({ try { [System.Windows.Forms.Clipboard]::SetText($details.Text); $copy.Text = 'คัดลอกแล้ว' } catch { $details.SelectAll(); $details.Focus() } })
        $close = New-Object System.Windows.Forms.Button
        $close.Text = 'ปิด'; $close.SetBounds(464, 276, 122, 32); $close.Add_Click({ $form.Close() })
        $form.Controls.AddRange(@($heading, $details, $copy, $close)); $form.CancelButton = $close
        [void]$form.ShowDialog(); $form.Dispose()
    } catch {
        # A visible fallback is necessary because the shortcut hides stdout.
        $popup = New-Object -ComObject WScript.Shell
        [void]$popup.Popup("$message`r`n$diagnostic", 0, 'KumonDB', 16)
    }
}

function Get-KumonLocalRuntime {
    # Use the same local IPv4 listener as the server. On some Windows machines
    # localhost resolution/fallback alone exceeds the short readiness timeout.
    try {
        $runtime = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/system/runtime' -TimeoutSec 2 -ErrorAction Stop
        if ($runtime.success -and $runtime.instanceId) { return $runtime }
    } catch { }
    return $null
}

function Open-KumonDesktopWindow {
    # The server still opens the app at its existing localhost origin; this
    # address is only the launcher's loopback request, not the browser URL.
    $desktop = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/system/desktop/show' -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 40 -ErrorAction Stop
    if (-not $desktop.success) { throw 'The server started but its desktop window could not be opened.' }
}

function Wait-KumonDesktop {
    param([int]$TimeoutSeconds = 90, $Progress = $null)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if ($Progress) {
            $state = $null
            try { $state = Get-Content -LiteralPath $Progress.Path -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json } catch { }
            if ($state.attemptId -eq $Progress.Attempt -and $state.status -eq 'error') {
                throw 'The server could not finish loading. Startup timing details are available in the KumonDB startup report.'
            }
        }
        if (Get-KumonLocalRuntime) { $ready = $true; break }
        Start-Sleep -Milliseconds 500
    }
    # A server can finish starting between the last poll and the deadline.
    # Confirm once more before reporting a failed launch; still fail visibly
    # when it is unavailable or the desktop cannot actually be opened.
    if (-not $ready) { $ready = [bool](Get-KumonLocalRuntime) }
    if (-not $ready) { throw 'The local server did not become ready within the startup deadline.' }
    Open-KumonDesktopWindow
}
