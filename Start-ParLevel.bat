@echo off
cd /d "%~dp0"
echo.
echo  Inventi — by shavi labs
echo  ---------------------------------
echo  Local:   http://localhost:8081
echo  Phone:   http://YOUR-PC-IP:8081  (same Wi-Fi, run with --host 0.0.0.0)
echo.
py -3 -m pip install -r requirements.txt -q
py -3 -m uvicorn main:app --host 0.0.0.0 --port 8081 --reload
pause
