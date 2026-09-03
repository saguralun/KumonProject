# Backs up the KumonDB PostgreSQL database via pg_dump, in the compressed
# "custom" format (-Fc) — smaller than plain SQL, and restorable as a whole
# or selectively (pg_restore --table=...) rather than just as one big
# script. Meant to run both automatically (Windows Task Scheduler) and
# by hand any time (double-click, or `powershell -File backup-database.ps1`)
# — same script either way, no separate "manual" version to keep in sync.
#
# Where backups land is per-machine, not hardcoded: set BACKUP_DIR in this
# machine's own .env (already git-ignored — never shared between centers)
# to point at wherever that machine's cloud-sync folder actually is, e.g.
#   BACKUP_DIR=C:\Users\Kumon\Google Drive\KumonDB-Backups
# A machine with no cloud folder set up yet just gets project-local
# backups\ instead (see $BackupDir below) — not off-site, but still a
# real safety net against "oops, wrong UPDATE" until BACKUP_DIR is set.
#
# Usage: powershell -File backup-database.ps1
# (Task Scheduler: same command, "Start in" = this project's root folder.)

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $PSScriptRoot
$LogFile = Join-Path $ProjectDir "backups\backup.log"

function Write-Log {
    param([string]$Message)
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
    Write-Output $line
    # Log file itself always lives project-locally (not in BACKUP_DIR,
    # which might not exist yet the very first time this runs) — created
    # alongside backups\ below before this is ever called.
    Add-Content -Path $LogFile -Value $line -ErrorAction SilentlyContinue
}

try {
    # --- 1) Load this machine's .env (DB_* and, optionally, BACKUP_DIR) --

    $EnvFile = Join-Path $ProjectDir ".env"

    if (-not (Test-Path $EnvFile)) {
        throw ".env not found at $EnvFile — can't read DB connection details."
    }

    $EnvVars = @{}
    Get-Content $EnvFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.*)\s*$') {
            $EnvVars[$matches[1]] = $matches[2]
        }
    }

    $DbHost = $EnvVars["DB_HOST"]
    $DbPort = $EnvVars["DB_PORT"]
    $DbName = $EnvVars["DB_NAME"]
    $DbUser = $EnvVars["DB_USER"]
    $DbPassword = $EnvVars["DB_PASSWORD"]

    if (-not $DbHost -or -not $DbName -or -not $DbUser) {
        throw "DB_HOST/DB_NAME/DB_USER missing from .env — check it's a normal KumonDB .env file."
    }

    # --- 2) Where backups go: BACKUP_DIR from .env, else project-local ----

    $BackupDir = $EnvVars["BACKUP_DIR"]
    if (-not $BackupDir) {
        $BackupDir = Join-Path $ProjectDir "backups"
    }

    if (-not (Test-Path $BackupDir)) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    }
    # Log file's own folder (project-local backups\, regardless of where
    # BACKUP_DIR points) — separate from $BackupDir so the log always has
    # somewhere to go even before BACKUP_DIR exists/is reachable.
    $LocalBackupDir = Join-Path $ProjectDir "backups"
    if (-not (Test-Path $LocalBackupDir)) {
        New-Item -ItemType Directory -Path $LocalBackupDir -Force | Out-Null
    }

    # --- 3) Find pg_dump.exe ----------------------------------------------

    $PgDumpPath = $EnvVars["PG_DUMP_PATH"]
    if (-not $PgDumpPath -or -not (Test-Path $PgDumpPath)) {
        # Not necessarily on PATH (confirmed not, on this machine) — search
        # every installed PostgreSQL version's bin folder, newest first, so
        # a machine with both 17 and 18 installed (like this one) prefers
        # the newer one rather than whichever sorts first alphabetically.
        $found = Get-ChildItem -Path "C:\Program Files\PostgreSQL\*\bin\pg_dump.exe" -ErrorAction SilentlyContinue |
            Sort-Object { [int]($_.Directory.Parent.Name) } -Descending |
            Select-Object -First 1

        if (-not $found) {
            throw "pg_dump.exe not found under C:\Program Files\PostgreSQL\*\bin\ — set PG_DUMP_PATH in .env to its exact location if PostgreSQL is installed somewhere else."
        }

        $PgDumpPath = $found.FullName
    }

    # --- 4) Run pg_dump -----------------------------------------------------

    $Timestamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
    $BackupFile = Join-Path $BackupDir "$DbName`_$Timestamp.backup"

    Write-Log "Starting backup of '$DbName' -> $BackupFile"

    # PGPASSWORD (not a -W/--password prompt, and not a command-line flag
    # either — that would show up in the process list) is libpq's own
    # documented way to pass this non-interactively.
    $env:PGPASSWORD = $DbPassword

    & $PgDumpPath -h $DbHost -p $DbPort -U $DbUser -d $DbName -Fc -f $BackupFile

    if ($LASTEXITCODE -ne 0) {
        throw "pg_dump exited with code $LASTEXITCODE"
    }

    $env:PGPASSWORD = $null

    $sizeMb = [math]::Round((Get-Item $BackupFile).Length / 1MB, 2)
    Write-Log "Backup succeeded: $BackupFile ($sizeMb MB)"

    # --- 5) Clean up old backups in $BackupDir ------------------------------

    # Monthly-ish use is the expected cadence here, not daily — 12 kept
    # backups is roughly a year of history either way, so this stays a
    # sensible cap whether this ends up run monthly, weekly, or by hand
    # whenever someone remembers to.
    $KeepCount = 12
    $oldBackups = Get-ChildItem -Path $BackupDir -Filter "$DbName`_*.backup" |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip $KeepCount

    foreach ($old in $oldBackups) {
        Remove-Item $old.FullName -Force
        Write-Log "Deleted old backup: $($old.Name)"
    }

    Write-Log "Done."
}
catch {
    Write-Log "BACKUP FAILED: $($_.Exception.Message)"
    exit 1
}
