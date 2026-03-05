# Deploy resume-app and resume-backend on AWS Lightsail

## 1. Create a Lightsail instance

1. In [AWS Lightsail](https://lightsail.aws.amazon.com), create an instance.
2. Pick a **Linux/Unix** platform (e.g. **Node.js** or **OS Only** → Ubuntu).
3. Choose a plan and create the instance.
4. Note the **public IP** and ensure the instance is running.

## 2. Connect and install Node.js + PM2 (one-time)

SSH into the instance (use the SSH key Lightsail shows, or add your own in Account → SSH keys):

```bash
# If using Lightsail’s default key (replace with your key path and instance name):
ssh -i /path/to/your-key.pem ubuntu@YOUR_LIGHTSAIL_IP
```

On the instance, install Node.js (LTS) and PM2:

```bash
# Node 20 LTS (Ubuntu/Debian)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2
sudo npm install -g pm2

# Optional: keep apps running after reboot
pm2 startup
# Run the command it prints (sudo ...)
```

## 3. Configure deploy from your machine

In both **resume-app** and **resume-backend** repos, create a `.deploy.env` from the example and set your Lightsail IP and user:

**resume-app:**

```bash
cd /Users/dev/Documents/resume-app
cp .deploy.env.example .deploy.env
# Edit .deploy.env: set SERVER_IP=YOUR_LIGHTSAIL_IP and SERVER_USER=ubuntu
```

**resume-backend:**

```bash
cd /Users/dev/Documents/resume-backend
cp .deploy.env.example .deploy.env
# Same: SERVER_IP and SERVER_USER=ubuntu
```

Use the same `SERVER_IP` and `SERVER_USER` in both so frontend and backend deploy to the same instance.

## 4. Backend .env on the server (one-time)

After the first backend deploy, SSH into the instance and create the backend env file:

```bash
ssh ubuntu@YOUR_LIGHTSAIL_IP
sudo nano /var/www/resume-backend/.env
```

Add:

```
GEMINI_API_KEY=your_gemini_key
OPENAI_API_KEY=your_openai_key
PORT=3001
```

Then restart:

```bash
pm2 restart resume-backend
```

## 5. Deploy

**Backend first**, then frontend (frontend needs the backend URL).

```bash
# Backend
cd /Users/dev/Documents/resume-backend
chmod +x deploy-lightsail.sh
./deploy-lightsail.sh

# Frontend
cd /Users/dev/Documents/resume-app
chmod +x deploy-lightsail.sh
./deploy-lightsail.sh
```

If SSH asks for a password, use your instance password or switch to key-based auth (e.g. add your public key to `~/.ssh/authorized_keys` on the instance).

## 6. URLs

- **Backend:** `http://YOUR_LIGHTSAIL_IP:3001`
- **Frontend:** `http://YOUR_LIGHTSAIL_IP:3002`

Open the frontend URL in a browser. To use a domain or HTTPS, put a reverse proxy (e.g. Nginx or Caddy) in front of ports 3001 and 3002 on the same Lightsail instance.
