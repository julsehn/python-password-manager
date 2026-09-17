@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
:: Caixa Forta - Windows Native Messaging Host Registration
:: Registers the native messaging host for Chrome and Firefox on Windows
:: ============================================================================

echo ========================================
echo   Caixa Forta - Windows Registration
echo ========================================
echo.

:: Get the directory where this script is located
set "SCRIPT_DIR=%~dp0"
set "PROJECT_DIR=%SCRIPT_DIR%"

:: Define paths
set "HOST_SCRIPT=%PROJECT_DIR%browser-extension\native\caixa_forta_native.py"
set "HOST_NAME=caixa_forta"

:: Check if host script exists
if not exist "%HOST_SCRIPT%" (
    echo ERROR: Host script not found: %HOST_SCRIPT%
    pause
    exit /b 1
)

:: Create a batch wrapper for the Python script
set "WRAPPER_SCRIPT=%PROJECT_DIR%browser-extension\native\caixa_forta_native.bat"

echo Creating Windows batch wrapper...
(
    echo @echo off
    echo setlocal EnableDelayedExpansion
    echo.
    echo :: Get the directory where this script is located
    echo set "SCRIPT_DIR=%~dp0"
    echo.
    echo :: Run the Python script with all arguments
    echo python "%SCRIPT_DIR%caixa_forta_native.py" %*
    echo endlocal
) > "%WRAPPER_SCRIPT%"

echo %WRAPPER_SCRIPT%

if errorlevel 1 (
    echo ERROR: Failed to create wrapper script
    pause
    exit /b 1
)

:: Make wrapper executable
echo %WRAPPER_SCRIPT%

echo.
echo ========================================
echo   Registering for Firefox
echo ========================================
echo.

:: Firefox registration
:: Firefox uses: %APPDATA%\Mozilla\Firefox\Profiles\<profile>\_locales\en\NativeMessagingHosts\
:: Or: %APPDATA%\Mozilla\Firefox\NativeMessagingHosts\

set "FF_NATIVE_DIR=%APPDATA%\Mozilla\Firefox\NativeMessagingHosts"
if not exist "%FF_NATIVE_DIR%" (
    mkdir "%FF_NATIVE_DIR%"
)

:: Create Firefox manifest
(
    echo {
    echo   "name": "%HOST_NAME%",
    echo   "description": "Caixa Forta Native Messaging Host",
    echo   "path": "%WRAPPER_SCRIPT%",
    echo   "type": "stdio",
    echo   "allowed_extensions": [
    echo     "caixa-forta@juls.com"
    echo   ]
    echo }
) > "%FF_NATIVE_DIR%\%HOST_NAME%.json"

echo Firefox manifest created: %FF_NATIVE_DIR%\%HOST_NAME%.json
echo.

echo ========================================
echo   Registering for Chrome
echo ========================================
echo.

:: Chrome registration
:: Chrome uses: %LOCALAPPDATA%\Google\Chrome\User Data\Default\NativeMessagingHosts\

set "CHROME_NATIVE_DIR=%LOCALAPPDATA%\Google\Chrome\User Data\Default\NativeMessagingHosts"
if not exist "%CHROME_NATIVE_DIR%" (
    mkdir "%CHROME_NATIVE_DIR%"
)

:: Create Chrome manifest
(
    echo {
    echo   "name": "%HOST_NAME%",
    echo   "description": "Caixa Forta Native Messaging Host",
    echo   "path": "%WRAPPER_SCRIPT%",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://lcbgmkafanopplcefoapdfmhhjfoaamd/"
    echo   ]
    echo }
) > "%CHROME_NATIVE_DIR%\%HOST_NAME%.json"

echo Chrome manifest created: %CHROME_NATIVE_DIR%\%HOST_NAME%.json
echo.

echo ========================================
echo   Registration Complete!
echo ========================================
echo.
echo Firefox manifest: %FF_NATIVE_DIR%\%HOST_NAME%.json
echo Chrome manifest: %CHROME_NATIVE_DIR%\%HOST_NAME%.json
echo.
echo Next steps:
echo 1. Start the native messaging host:
echo    python "%HOST_SCRIPT%"
echo.
echo 2. Load the extension in Firefox:
echo    - Open about:debugging
echo    - Click "This Firefox" -> "Load Temporary Add-on..."
echo    - Select: %PROJECT_DIR%browser-extension\manifest.json
echo.
echo 3. Test the connection from the extension popup
echo.

pause
