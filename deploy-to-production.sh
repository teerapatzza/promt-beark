#!/bin/bash
# Auto-deploy script for Prompt-Berk Production Server
# This script will be executed on the production server

set -e  # Exit on error

echo "🚀 Starting Prompt-Berk deployment..."

# Step 1: Find project directory
echo "📂 Finding project directory..."
PROJECT_DIR=$(find /home /root /opt -name "docker-compose.yml" -type f 2>/dev/null | xargs grep -l "promt-beark" 2>/dev/null | head -1 | xargs dirname)

if [ -z "$PROJECT_DIR" ]; then
    echo "❌ Error: Cannot find promt-beark project directory"
    exit 1
fi

echo "✅ Found project at: $PROJECT_DIR"
cd "$PROJECT_DIR"

# Step 2: Backup current state
echo "💾 Backing up current containers state..."
docker ps -a > /tmp/containers-before-deploy.txt

# Step 3: Verify docker-compose.yml
echo "🔍 Verifying docker-compose.yml..."
if ! grep -q "promt-beark" docker-compose.yml; then
    echo "❌ Error: docker-compose.yml does not contain promt-beark"
    exit 1
fi

# Step 4: Pull latest code
echo "📥 Pulling latest code from GitHub..."
git fetch origin
git pull origin main

# Step 5: Rebuild containers (only promt-beark)
echo "🔨 Rebuilding Prompt-Berk containers..."
docker compose up -d --build

# Step 6: Wait for containers to be healthy
echo "⏳ Waiting for containers to start..."
sleep 5

# Step 7: Verify deployment
echo "✅ Checking deployment status..."
docker ps --filter "name=promt-beark" --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

# Step 8: Test endpoints
echo "🧪 Testing endpoints..."
if curl -f -s http://localhost:8080/login.html > /dev/null; then
    echo "✅ Login page: OK"
else
    echo "❌ Login page: FAILED"
fi

if curl -f -s http://localhost:8080/health > /dev/null; then
    echo "✅ Backend health: OK"
else
    echo "❌ Backend health: FAILED"
fi

# Step 9: Verify other systems not affected
echo "🔍 Verifying other systems..."
docker ps -a > /tmp/containers-after-deploy.txt

echo ""
echo "✅ Deployment completed!"
echo "📊 Summary:"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
