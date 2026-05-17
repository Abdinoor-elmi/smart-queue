@echo off
echo Starting SmartQueue Digital Queue Management System...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if package.json exists
if not exist package.json (
    echo Error: package.json not found
    echo Please run this script from the smart-queue directory
    pause
    exit /b 1
)

REM Install dependencies if node_modules doesn't exist
if not exist node_modules (
    echo Installing dependencies...
    npm install
    if %errorlevel% neq 0 (
        echo Error: Failed to install dependencies
        pause
        exit /b 1
    )
    echo.
)

REM Create database directory if it doesn't exist
if not exist database mkdir database

echo SmartQueue is starting...
echo.
echo Access URLs:
echo - Customer Kiosk: http://localhost:3000
echo - Staff Dashboard: http://localhost:3000/staff
echo - Admin Panel: http://localhost:3000/admin
echo - Public Display: http://localhost:3000/display
echo.
echo Default Admin Login:
echo - Username: admin
echo - Password: admin123
echo.
echo Press Ctrl+C to stop the server
echo.

REM Start the server
npm start