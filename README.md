# DTF Backend Service

Backend service for DTF Reseller Tool with OAuth 2.0 Dropbox integration.

## Features

- ✅ OAuth 2.0 token management (automatic refresh)
- ✅ Quote management (save, load, delete)
- ✅ Customer logo management
- ✅ Secure API endpoints
- ✅ Railway deployment ready
- ✅ CORS configured for Shopify stores

## Setup

### 1. Dropbox App Configuration

1. Go to [Dropbox Developers](https://www.dropbox.com/developers/apps)
2. Create a new app:
   - **API**: Scoped access
   - **Type**: App folder or Full Dropbox
   - **Name**: `DTF-Backend-YourStoreName`
3. Get your **App key** and **App secret**
4. Add redirect URI: `http://localhost:3000/auth/callback` (for initial setup)

### 2. Get Initial Refresh Token

You need to do this **once** to get a refresh token:

```bash
# Install dependencies
npm install

# Set up environment (copy .env.example to .env)
cp .env.example .env

# Add your Dropbox credentials to .env
DROPBOX_APP_KEY=your_app_key_here
DROPBOX_APP_SECRET=your_app_secret_here
```

**Get refresh token manually:**
1. Visit: `https://www.dropbox.com/oauth2/authorize?client_id=YOUR_APP_KEY&response_type=code&redirect_uri=http://localhost:3000/auth/callback`
2. Grant permissions, get authorization code
3. Exchange for refresh token using curl:

```bash
curl -X POST https://api.dropbox.com/oauth2/token \\
  -d grant_type=authorization_code \\
  -d code=YOUR_AUTH_CODE \\
  -d client_id=YOUR_APP_KEY \\
  -d client_secret=YOUR_APP_SECRET
```

4. Add the `refresh_token` to your `.env` file

### 3. Local Testing

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Test health check
curl http://localhost:3000/health
```

## Deployment

### Railway Deployment

1. **Create GitHub Repository:**
   ```bash
   git init
   git add .
   git commit -m "Initial DTF backend setup"
   gh repo create dtf-backend --public
   git remote add origin https://github.com/your-username/dtf-backend.git
   git push -u origin main
   ```

2. **Deploy to Railway:**
   ```bash
   railway login
   railway init
   railway link
   ```

3. **Set Environment Variables in Railway:**
   ```bash
   railway variables set DROPBOX_APP_KEY=your_app_key
   railway variables set DROPBOX_APP_SECRET=your_app_secret  
   railway variables set DROPBOX_REFRESH_TOKEN=your_refresh_token
   railway variables set ALLOWED_ORIGINS=https://your-store.myshopify.com
   ```

4. **Deploy:**
   ```bash
   railway up
   ```

## API Endpoints

### Quotes
- `POST /api/save-quote` - Save quote to Dropbox
- `GET /api/get-quote/:quoteId` - Get specific quote
- `GET /api/customer-quotes/:customerId` - Get all quotes for customer
- `DELETE /api/delete-quote/:quoteId` - Delete quote

### Logos
- `POST /api/save-logo/:customerId` - Save customer logo
- `GET /api/get-logo/:customerId` - Get customer logo
- `DELETE /api/delete-logo/:customerId` - Delete customer logo

### Health
- `GET /health` - Service health check

## Frontend Integration

Update your `dtf-quote-manager.js` to use your backend:

```javascript
class DTFQuoteManager {
  constructor(backendUrl, shopDomain) {
    this.backendUrl = backendUrl; // e.g., 'https://your-backend.railway.app'
    this.shopDomain = shopDomain;
  }

  async saveQuote(quoteData, isUpdate = false) {
    const response = await fetch(\`\${this.backendUrl}/api/save-quote\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteData, isUpdate })
    });
    return await response.json();
  }
  
  // ... other methods
}
```

## Security

- ✅ Tokens stored securely on server
- ✅ Automatic token refresh
- ✅ CORS protection
- ✅ Input validation
- ✅ Error handling

## Monitoring

- Health check endpoint for uptime monitoring
- Comprehensive logging
- Automatic token refresh scheduling
# Location Data Fix Deployed Wed Aug 13 17:09:11 EDT 2025
