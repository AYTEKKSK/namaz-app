@echo off
chcp 65001 >nul
title Namaz Vakitleri - app.articnc.online/namaz
echo ==> https://app.articnc.online/namaz
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5055 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000 " ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
timeout /t 1 /nobreak >nul
start "Namaz :5055" /MIN C:\visualdeneme\.venv\Scripts\python.exe "%~dp0app.py"
timeout /t 3 /nobreak >nul
start "Ana Flask :5000" /MIN C:\visualdeneme\.venv\Scripts\python.exe "d:\yazilimyedekler\visualdeneme15\basit_hesap_makinesi.py"
timeout /t 5 /nobreak >nul
"d:\yazilimyedekler\visualdeneme15\cloudflared.exe" tunnel --config "C:\Users\aytek\.cloudflared\config.yml" run
pause
