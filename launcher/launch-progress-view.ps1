param([string]$StatusFile, [string]$AttemptId, [int]$OwnerPid)

function New-KumonProgressForm {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [Windows.Forms.Application]::EnableVisualStyles()
    $form = New-Object System.Windows.Forms.Form
    $form.Text = 'กำลังเปิด KumonDB'
    $form.ClientSize = New-Object System.Drawing.Size(500, 310)
    $form.StartPosition = 'CenterScreen'; $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false; $form.MinimizeBox = $false
    $form.BackColor = [Drawing.Color]::FromArgb(244, 248, 252)
    $form.Font = New-Object Drawing.Font('Leelawadee UI', 11)
    $heading = New-Object Windows.Forms.Label
    $heading.Text = 'KumonDB'; $heading.Font = New-Object Drawing.Font('Segoe UI', 20, [Drawing.FontStyle]::Bold)
    $heading.SetBounds(26, 20, 440, 42)
    $stage = New-Object Windows.Forms.Label
    $stage.Font = New-Object Drawing.Font('Leelawadee UI', 12, [Drawing.FontStyle]::Bold)
    $stage.Name = 'Stage'; $stage.Text = 'กำลังตรวจโปรแกรม...'; $stage.SetBounds(28, 82, 440, 30)
    $bar = New-Object Windows.Forms.ProgressBar
    $bar.Style = 'Marquee'; $bar.MarqueeAnimationSpeed = 25; $bar.SetBounds(28, 125, 440, 10)
    $elapsed = New-Object Windows.Forms.Label
    $elapsed.Name = 'Elapsed'; $elapsed.ForeColor = [Drawing.Color]::FromArgb(88, 105, 126); $elapsed.SetBounds(28, 151, 440, 28)
    $hint = New-Object Windows.Forms.Label
    $hint.Name = 'Hint'; $hint.Text = 'โปรแกรมจะเปิดให้ใช้งานเมื่อพร้อม'; $hint.SetBounds(28, 187, 440, 48)
    $copy = New-Object Windows.Forms.Button
    $copy.Text = 'คัดลอกรายละเอียด'; $copy.SetBounds(28, 253, 190, 34)
    $copy.Add_Click({ try { [Windows.Forms.Clipboard]::SetText([string]$this.FindForm().Tag); $this.Text = 'คัดลอกแล้ว' } catch { } })
    $hide = New-Object Windows.Forms.Button
    $hide.Text = 'ซ่อนหน้าต่างนี้'; $hide.SetBounds(286, 253, 182, 34)
    $hide.Add_Click({ $this.FindForm().Close() })
    $form.Controls.AddRange(@($heading, $stage, $bar, $elapsed, $hint, $copy, $hide))
    return $form
}

function Set-KumonProgressView {
    param($Form, $State)
    $labels = @{ checking = 'ตรวจโปรแกรม'; starting = 'เริ่มเซิร์ฟเวอร์'; modules = 'โหลดส่วนประกอบโปรแกรม';
        server = 'เซิร์ฟเวอร์พร้อมแล้ว'; desktop = 'เปิดหน้าต่าง KumonDB'; login = 'โหลดหน้าล็อกอิน';
        ready = 'พร้อมใช้งาน'; error = 'เปิดโปรแกรมยังไม่สำเร็จ' }
    if (-not $labels.ContainsKey([string]$State.stage)) { return }
    $seconds = [Math]::Max(0, [Math]::Floor(([datetime]::UtcNow - [datetime]::Parse($State.startedAt).ToUniversalTime()).TotalSeconds))
    $Form.Controls['Stage'].Text = $labels[[string]$State.stage] + '...'
    $Form.Controls['Elapsed'].Text = "รอแล้ว $seconds วินาที"
    if ($seconds -ge 30) { $Form.Controls['Hint'].Text = 'ใช้เวลานานกว่าปกติ กำลังรอขั้นตอนนี้อยู่ ไม่ต้องเปิดโปรแกรมซ้ำ' }
    $Form.Tag = "KumonDB`r`nComputer: $env:COMPUTERNAME`r`nWaitSeconds: $seconds`r`n" + ($State | ConvertTo-Json -Depth 6)
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        $form = New-KumonProgressForm
        $timer = New-Object Windows.Forms.Timer
        $timer.Interval = 350
        $timer.Add_Tick({
            if (-not (Get-Process -Id $OwnerPid -ErrorAction SilentlyContinue)) { $form.Close(); return }
            try {
                $state = Get-Content -LiteralPath $StatusFile -Raw -Encoding UTF8 -ErrorAction Stop | ConvertFrom-Json
                if ($state.attemptId -ne $AttemptId -or $state.status -ne 'loading') { $form.Close(); return }
                Set-KumonProgressView -Form $form -State $state
                # Closing the feedback never closes a server or another app.
            } catch { } # Reading while a writer replaces the small file is retryable.
        })
        $timer.Start()
        [void]$form.ShowDialog()
        $timer.Stop(); $timer.Dispose(); $form.Dispose()
    } catch { } # The application can still open if feedback is unavailable.
}
