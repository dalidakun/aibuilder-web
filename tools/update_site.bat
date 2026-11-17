@echo off
rem aibuilder.top publish helper: drag an APK onto this file, or run with args.
rem Usage: update_site.bat <apk-path> <x.y.z+NN> [--notes "text"]
setlocal
cd /d "%~dp0.."
if "%~1"=="" goto usage
if "%~2"=="" goto usage
python tools\update_site.py --apk "%~1" --version %~2 %3 %4 %5 %6 %7 %8 %9
pause
exit /b
:usage
echo Usage:
echo   update_site.bat "path\to\app-release.apk" 3.5.3+39
echo   update_site.bat "path\to\app-release.apk" 3.5.3+39 --notes "fix ..."
pause
exit /b 1
