@echo off
REM ─────────────────────────────────────────────────────────────
REM  Simalytics - denny lokalni backup svicek (druhy zdroj dat)
REM  Volani z Windows Task Scheduleru (denne, doporuceno 03:30).
REM
REM  Nastaveni ulohy (rucne v Task Scheduleru):
REM    1. Create Basic Task -> nazev "Simalytics backup candles"
REM    2. Trigger: Daily, cas 03:30 (po nocnim GitHub cronu 01:10 UTC,
REM       ktery = 02:10 letni / 03:10 zimni stredoevropsky cas)
REM    3. Action: Start a program:
REM       "C:\Users\Admin\Documents\GitHub\Simalytics\scripts\backup-candles-task.bat"
REM       Start in: "C:\Users\Admin\Documents\GitHub\Simalytics"
REM    4. Doporuceno: "Run whether user is logged on or not" (农户behes
REM       without net), ale "Run only when user is logged on" je fine
REM       pro laptop. Ne zaskrtnout "Stop if the computer..." default.
REM  ─────────────────────────────────────────────────────────────

cd /d "%~dp0.."
call npm run backup:candles >> "%TEMP%\simalytics-backup.log" 2>&1
echo %date% %time% exit=%errorlevel% >> "%TEMP%\simalytics-backup.log"
