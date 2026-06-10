@echo off
REM Business Area QA — Windows 실행 파일 (더블클릭·드래그앤드롭용 래퍼)
REM 사용: business-area-qa.cmd --help
REM      business-area-qa.cmd --baseline-url "..." --baseline-xlsx "..." ...
cd /d "%~dp0"
if not exist "node_modules" (
  echo [business-area-qa] 최초 실행: npm install ...
  call npm install
  if errorlevel 1 exit /b 1
)
node bin\business-area-qa.js %*
exit /b %ERRORLEVEL%
