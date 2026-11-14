@echo off
chcp 65001 >nul
rem Запускает setup-obs.ps1 (PowerShell 7, если установлен, иначе Windows PowerShell)
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-obs.ps1" %*
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-obs.ps1" %*
)
pause
