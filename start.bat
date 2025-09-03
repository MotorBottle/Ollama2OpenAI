@echo off
REM Ollama2OpenAI Gateway Startup Script for Windows

echo 🚀 Starting Ollama2OpenAI Gateway...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not installed. Please install npm first.
    pause
    exit /b 1
)

REM Create necessary directories
if not exist "data" mkdir data
if not exist "logs" mkdir logs

REM Copy environment file if it doesn't exist
if not exist ".env" (
    if exist ".env.example" (
        echo 📋 Creating .env file from .env.example...
        copy .env.example .env
        echo ⚠️  Please edit .env file to configure your settings
    )
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    npm install
)

REM Check if Ollama is running (simplified check for Windows)
echo 🔍 Checking Ollama connection...
echo ⚠️  Please ensure Ollama is running: ollama serve

REM Start the server
echo 🌟 Starting Ollama2OpenAI Gateway...
echo 🌐 Admin interface will be available at: http://localhost:3000
echo 🔗 API endpoint will be available at: http://localhost:3000/v1/chat/completions
echo 👤 Default admin credentials: admin/admin
echo.
echo Press Ctrl+C to stop the server
echo ================================

REM Start the application
npm start

pause