@echo off
cd /d "%~dp0"
node.exe scripts\start-mobile-preview.mjs
if errorlevel 1 pause
