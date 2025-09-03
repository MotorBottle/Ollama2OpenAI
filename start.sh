#!/bin/bash

# Ollama2OpenAI Gateway Startup Script

echo "🚀 Starting Ollama2OpenAI Gateway..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

# Create necessary directories
mkdir -p data logs

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "📋 Creating .env file from .env.example..."
        cp .env.example .env
        echo "⚠️  Please edit .env file to configure your settings"
    fi
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Check if Ollama is running
echo "🔍 Checking Ollama connection..."
OLLAMA_URL=${OLLAMA_URL:-http://localhost:11434}

if curl -s "$OLLAMA_URL/api/tags" > /dev/null; then
    echo "✅ Ollama is running and accessible at $OLLAMA_URL"
else
    echo "⚠️  Warning: Cannot connect to Ollama at $OLLAMA_URL"
    echo "   Please make sure Ollama is running: ollama serve"
    echo "   Or update OLLAMA_URL in your .env file"
fi

# Start the server
echo "🌟 Starting Ollama2OpenAI Gateway..."
echo "🌐 Admin interface will be available at: http://localhost:${PORT:-3000}"
echo "🔗 API endpoint will be available at: http://localhost:${PORT:-3000}/v1/chat/completions"
echo "👤 Default admin credentials: admin/admin"
echo ""
echo "Press Ctrl+C to stop the server"
echo "================================"

# Load environment variables if .env exists
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Start the application
npm start