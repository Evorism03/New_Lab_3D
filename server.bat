@echo off
chcp 65001 >nul
rem   server.bat            - окно управления (Lab3D.exe; соберётся при первом запуске)
rem   server.bat menu       - то же самое меню, но в консоли
rem   server.bat start|stop|restart|status|logs|update|setup|autostart|cleanup|uninstall
if "%~1"=="" goto gui
if /I "%~1"=="gui" goto gui
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\server.ps1" %*
goto :eof

:gui
if not exist "%~dp0Lab3D.exe" powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\build-exe.ps1"
if not exist "%~dp0Lab3D.exe" goto :eof
start "" "%~dp0Lab3D.exe"
