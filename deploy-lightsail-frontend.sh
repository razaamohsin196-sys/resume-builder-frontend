#!/bin/bash

# AWS Lightsail Frontend Deployment Script
# Run this from your local machine

# ============================================
# CONFIGURATION - UPDATE THESE VALUES
# ============================================
LIGHTSAIL_INSTANCE_NAME="resume-frontend"  # Your Lightsail instance name (can be same as backend)
LIGHTSAIL_REGION="us-east-1"               # Your Lightsail region
SSH_USER="admin"                            # Username for Lightsail instance
APP_DIR="/var/www/resume-app"
FRONTEND_PORT="3000"
BACKEND_IP="54.151.247.230"                 # Your backend instance IP
BACKEND_PORT="3001"

# Get the instance IP (you'll need to set this manually first time)
# Frontend instance IP (different from backend)
# Frontend instance IP (separate from backend)
INSTANCE_IP="54.169.207.7"  # Set this to your Lightsail frontend instance IP

# Path to your Lightsail SSH private key (download from AWS Lightsail console)
SSH_KEY="${SSH_KEY:-$HOME/Downloads/lightsail-key.pem}"

# ============================================
# DEPLOYMENT SCRIPT
# ============================================

if [ -z "$INSTANCE_IP" ]; then
    echo "❌ ERROR: Please set INSTANCE_IP in this script"
    exit 1
fi

if [ -z "$BACKEND_IP" ]; then
    echo "❌ ERROR: Please set BACKEND_IP in this script"
    exit 1
fi

if [ ! -f "$SSH_KEY" ]; then
    echo "❌ ERROR: SSH key not found at: $SSH_KEY"
    echo "   Download your key from AWS Lightsail console or set SSH_KEY=/path/to/your-key.pem"
    exit 1
fi

BACKEND_URL="http://$BACKEND_IP:$BACKEND_PORT"

echo "🚀 Starting frontend deployment to Lightsail..."
echo "   Instance: $LIGHTSAIL_INSTANCE_NAME"
echo "   IP: $INSTANCE_IP"
echo "   Backend URL: $BACKEND_URL"
echo ""

# Build the project locally with production backend URL
echo "📦 Building frontend project with production backend URL..."
echo "   Setting NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL"
export NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL
npm run build

# Verify the build picked up the variable
echo "✅ Build complete. Verifying backend URL in build..."
if grep -r "$BACKEND_URL" .next/static/chunks/*.js 2>/dev/null | head -1 > /dev/null; then
    echo "   ✅ Backend URL found in build bundle"
else
    echo "   ⚠️  Warning: Backend URL not found in build bundle"
fi

# Create deployment archive (source code only - will build on server)
echo "📦 Creating deployment archive with source code..."
tar -czf deploy.tar.gz \
  app \
  components \
  context \
  lib \
  public \
  types \
  package.json \
  package-lock.json \
  next.config.ts \
  tsconfig.json \
  postcss.config.mjs \
  eslint.config.mjs \
  components.json

# Upload to server
echo "📤 Uploading to Lightsail instance..."
scp -i "$SSH_KEY" deploy.tar.gz $SSH_USER@$INSTANCE_IP:/tmp/

# SSH into server and deploy
echo "🔧 Deploying on server..."
ssh -i "$SSH_KEY" $SSH_USER@$INSTANCE_IP << ENDSSH
    set -e
    
    # Install Node.js 20.x if not already installed or if version is too old
    if ! command -v node &> /dev/null || [ "\$(node -v | cut -d'v' -f2 | cut -d'.' -f1)" -lt 20 ]; then
        echo "📦 Installing Node.js 20.x..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt install -y nodejs
    fi
    
    # Verify Node.js version
    echo "✅ Node.js version: \$(node -v)"
    
    # Create app directory if it doesn't exist
    sudo mkdir -p $APP_DIR
    sudo chown -R $SSH_USER:$SSH_USER $APP_DIR
    
    # Extract files
    cd $APP_DIR
    tar -xzf /tmp/deploy.tar.gz
    
    # Install ALL dependencies (including dev dependencies needed for build)
    npm install
    
    # Build on server so .next matches the newly deployed source (deploy tar does not include .next)
    echo "🔨 Building Next.js on server..."
    export NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL
    export NODE_ENV=production
    npm run build
    
    # Create .env.local and .env.production files
    echo "📝 Creating environment files..."
    cat > .env.local << EOF
NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL
NODE_ENV=production
PORT=$FRONTEND_PORT
EOF
    
    cat > .env.production << EOF
NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL
NODE_ENV=production
PORT=$FRONTEND_PORT
EOF
    
    # Verify the backend URL is set
    echo "✅ Backend URL configured: $BACKEND_URL"
    
    # Setup PM2 if not already installed
    if ! command -v pm2 &> /dev/null; then
        echo "📦 Installing PM2..."
        sudo npm install -g pm2
        pm2 startup systemd -u $SSH_USER --hp /home/$SSH_USER
    fi
    
    # Restart PM2 service with environment variables
    echo "🔄 Restarting frontend service..."
    pm2 delete resume-app 2>/dev/null || true
    cd $APP_DIR
    # Set environment variables for PM2 (NEXT_PUBLIC_ vars are baked in at build time, but set for runtime too)
    NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL NODE_ENV=production PORT=$FRONTEND_PORT pm2 start npm --name resume-app -- start
    pm2 save
    
    # Cleanup
    rm /tmp/deploy.tar.gz
    
    echo "✅ Frontend deployment complete!"
    echo "   Service status:"
    pm2 status
ENDSSH

# Cleanup local archive
rm deploy.tar.gz

echo ""
echo "✅ Frontend deployment finished!"
echo ""
echo "📝 Test your app:"
echo "   Frontend: http://$INSTANCE_IP:$FRONTEND_PORT"
echo "   Backend: http://$BACKEND_IP:$BACKEND_PORT/health"
