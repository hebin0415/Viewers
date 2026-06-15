@echo off
powershell.exe -ExecutionPolicy Bypass -File "%~dp0stop-production.ps1" %*
