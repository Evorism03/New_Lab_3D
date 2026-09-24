@echo off
chcp 65001 >nul
rem   lab.bat                 - консольное меню
rem   lab.bat start|stop|restart|status|logs|update|setup|autostart|uninstall
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0deploy\server.ps1" %*
