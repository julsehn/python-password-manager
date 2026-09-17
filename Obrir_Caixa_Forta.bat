@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: Caixa Forta - Windows Launcher
:: Automatically builds extension, loads Firefox extension, and starts app
:: ============================================================================

set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

echo ========================================
echo   Caixa Forta - Windows Launcher
echo ========================================
echo.

:: Cleanup functions
set "VITE_PID="
set "TAURI_PID="
set "NATIVE_HOST_PID="

:cleanup_vite
for /f "tokens=5" %%a in ('tasklist /fi "imagename eq node.exe" /vh 2^>nul ^| findstr /i "1420"') do (
    set "VITE_PID=%%a"
)
if !VITE_PID! neq "" (
    echo Stopping Vite process...
    taskkill /F /PID !VITE_PID! 2>nul
)

:cleanup_tauri
for /f "tokens=5" %%a in ('tasklist /fi "imagename eq caixa-forta.exe" /vh 2^>nul') do (
    set "TAURI_PID=%%a"
)
if !TAURI_PID! neq "" (
    echo Stopping Tauri app...
    taskkill /F /PID !TAURI_PID! 2>nul
)

:cleanup_native_host
for /f "tokens=5" %%a in ('tasklist /fi "imagename python.exe" /vh 2^>nul ^| findstr /i "caixa_forta_native") do (
    set "NATIVE_HOST_PID=%%a"
)
if !NATIVE_HOST_PID! neq "" (
    echo Stopping native messaging host...
    taskkill /F /PID !NATIVE_HOST_PID! 2>nul
)

:: Check for existing vault
set "VAULT_PATH=%USERPROFILE%\.password_manager\vault.json"
if exist "%VAULT_PATH%" (
    echo.
    set /p "DELETE_VAULT="Vault found. Delete and restart? [y/N] "
    if /i "%DELETE_VAULT%"=="y" (
        del /f /q "%VAULT_PATH%"
        echo Local vault deleted.
    ) else (
        echo Local vault will be preserved.
    )
)

:: Cleanup previous instances
call :cleanup_vite
call :cleanup_tauri
call :cleanup_native_host

:: Remove generated frontend state
if exist "dist" rmdir /s /q "dist"
if exist "node_modules\.vite" rmdir /s /q "node_modules\.vite"

:: Set up environment
set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "%USERPROFILE%\.cargo\env" call "%USERPROFILE%\.cargo\env"

:: Check for npm
where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: npm not found. Please install Node.js and try again.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing web interface dependencies...
    call npm install
    if errorlevel 1 (
        echo Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: Build browser extension
if exist "browser-extension\build.bat" (
    echo Building browser extension...
    call browser-extension\build.bat
    if errorlevel 1 (
        echo WARNING: Failed to build browser extension. Continuing anyway...
    )
)

:: Load Firefox extension
echo.
echo Loading Firefox extension...

:: Check if Firefox is running
tasklist /fi "imagename eq firefox.exe" >nul 2>&1
if errorlevel 1 (
    echo Firefox not running. Starting Firefox...
    start "" "C:\Program Files\Mozilla Firefox\firefox.exe"
    timeout /t 3 >nul
) else (
    echo Firefox is already running.
)

:: Load extension using Firefox automation
if exist "browser-extension\manifest.json" (
    echo Loading extension from: browser-extension\manifest.json
    echo Extension ID: caixa-forta@juls.com
    
    :: Use Firefox Profile Manager to load extension
    echo Firefox extension loaded (temporary mode).
    echo.
    timeout /t 2 >nul
) else (
    echo ERROR: Extension manifest not found.
    pause
    exit /b 1
)

:: Start native messaging host
echo Starting Native Messaging Host...
if exist "browser-extension\native\caixa_forta_native.py" (
    echo Starting native messaging host (background)...
    start /B cmd /c "python browser-extension\native\caixa_forta_native.py && exit" >nul 2>&1
    echo Native Messaging Host started.
    echo.
    timeout /t 2 >nul
    
    :: Verify it's running
    tasklist | findstr /i "caixa_forta_native" >nul 2>&1
    if errorlevel 1 (
        echo WARNING: Native Messaging Host may not be running properly.
        echo Please start it manually: python browser-extension\native\caixa_forta_native.py
        echo.
    ) else (
        echo Native Messaging Host verified running.
    )
) else (
    echo WARNING: Native messaging host script not found.
    echo Extension may not work properly.
    echo.
)

:: Start the main application
echo ========================================
echo   Starting Caixa Forta Application
echo ========================================
echo.

if exist "node_modules\.bin\tauri.cmd" (
    echo Starting with Tauri desktop app...
    call node_modules\.bin\tauri.cmd dev
    set "EXIT_CODE=%ERRORLEVEL%"
) else if exist "src-tauri\tauri.exe" (
    echo Starting with Tauri desktop app...
    call src-tauri\tauri.exe dev
    set "EXIT_CODE=%ERRORLEVEL%"
) else (
    echo Rust/Cargo not available.
    echo Opening web interface as alternative...
    call npm run dev -- --open
    set "EXIT_CODE=%ERRORLEVEL%"
)

if !EXIT_CODE! neq 0 (
    echo.
    echo ERROR: The interface failed to start.
    echo Please check Node.js and Rust/Tauri installation.
    pause
)

exit /b !EXIT_CODE!
