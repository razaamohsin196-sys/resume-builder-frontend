#!/bin/bash

# Deployment script for AWS Lightsail (frontend)
# 1. Copy .deploy.env.example to .deploy.env and set SERVER_IP and SERVER_USER.
# 2. On the Lightsail instance, install Node.js and PM2 (see DEPLOY_LIGHTSAIL.md).
# 3. Run: ./deploy-lightsail.sh

set -e
cd "$(dirname "$0")"

if [ -f .deploy.env ]; then
  set -a
  source .deploy.env
  set +a
fi

if [ -z "$SERVER_IP" ] || [ -z "$SERVER_USER" ]; then
  echo "❌ Set SERVER_IP and SERVER_USER in .deploy.env (copy from .deploy.env.example) or export them."
  exit 1
fi

APP_DIR="/var/www/resume-app"
BACKEND_URL="http://${SERVER_IP}:3001"

echo "🚀 Deploying frontend to Lightsail ($SERVER_USER@$SERVER_IP)..."

echo "📦 Building with production backend URL..."
NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL npm run build

echo "📦 Creating deployment archive..."
tar -czf deploy.tar.gz .next public package.json package-lock.json next.config.ts tsconfig.json

echo "📤 Uploading to server..."
scp deploy.tar.gz "$SERVER_USER@$SERVER_IP:/tmp/"

echo "🔧 Deploying on server..."
ssh "$SERVER_USER@$SERVER_IP" "mkdir -p $APP_DIR && cd $APP_DIR && tar -xzf /tmp/deploy.tar.gz && npm install && cat > .env.local << 'ENVEOF'
NEXT_PUBLIC_RESUME_BACKEND_URL=$BACKEND_URL
NODE_ENV=production
PORT=3002
ENVEOF
pm2 delete resume-app 2>/dev/null || true
pm2 start npm --name resume-app -- start
pm2 save
rm /tmp/deploy.tar.gz
echo '✅ Frontend deployment complete!'"

rm -f deploy.tar.gz
echo "✅ Done. Frontend: http://${SERVER_IP}:3002"
