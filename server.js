const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');
const DropboxService = require('./services/dropboxService');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Dropbox service
const dropboxService = new DropboxService();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS Configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'DTF Backend API' 
  });
});

// Quote management endpoints
app.post('/api/save-quote', async (req, res) => {
  try {
    const { quoteData, isUpdate = false } = req.body;
    
    if (!quoteData || !quoteData.id) {
      return res.status(400).json({ 
        error: 'Invalid quote data. Missing required fields.' 
      });
    }

    const result = await dropboxService.saveQuote(quoteData, isUpdate);
    res.json(result);
    
  } catch (error) {
    console.error('Save quote error:', error);
    res.status(500).json({ 
      error: 'Failed to save quote', 
      message: error.message 
    });
  }
});

app.get('/api/get-quote/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { format = 'json' } = req.query;
    
    if (!quoteId) {
      return res.status(400).json({ error: 'Quote ID is required' });
    }

    const quote = await dropboxService.loadQuote(quoteId, format);
    
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    res.json({ success: true, data: quote });
    
  } catch (error) {
    console.error('Get quote error:', error);
    res.status(500).json({ 
      error: 'Failed to load quote', 
      message: error.message 
    });
  }
});

app.get('/api/customer-quotes/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    const quotes = await dropboxService.loadCustomerQuotes(customerId);
    res.json({ success: true, data: quotes });
    
  } catch (error) {
    console.error('Get customer quotes error:', error);
    res.status(500).json({ 
      error: 'Failed to load customer quotes', 
      message: error.message 
    });
  }
});

app.delete('/api/delete-quote/:quoteId', async (req, res) => {
  try {
    const { quoteId } = req.params;
    const { customerId } = req.query;
    
    if (!quoteId) {
      return res.status(400).json({ error: 'Quote ID is required' });
    }

    const result = await dropboxService.deleteQuote(quoteId, customerId);
    res.json(result);
    
  } catch (error) {
    console.error('Delete quote error:', error);
    res.status(500).json({ 
      error: 'Failed to delete quote', 
      message: error.message 
    });
  }
});

// Logo management endpoints
app.post('/api/save-logo/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    const logoData = req.body;
    
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    const result = await dropboxService.saveCustomerLogo(customerId, logoData);
    res.json({ success: true, data: result });
    
  } catch (error) {
    console.error('Save logo error:', error);
    res.status(500).json({ 
      error: 'Failed to save logo', 
      message: error.message 
    });
  }
});

app.get('/api/get-logo/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    const logoData = await dropboxService.loadCustomerLogo(customerId);
    
    if (!logoData) {
      return res.status(404).json({ error: 'Logo not found' });
    }

    res.json({ success: true, data: logoData });
    
  } catch (error) {
    console.error('Get logo error:', error);
    res.status(500).json({ 
      error: 'Failed to load logo', 
      message: error.message 
    });
  }
});

app.delete('/api/delete-logo/:customerId', async (req, res) => {
  try {
    const { customerId } = req.params;
    
    if (!customerId) {
      return res.status(400).json({ error: 'Customer ID is required' });
    }

    const result = await dropboxService.deleteCustomerLogo(customerId);
    res.json(result);
    
  } catch (error) {
    console.error('Delete logo error:', error);
    res.status(500).json({ 
      error: 'Failed to delete logo', 
      message: error.message 
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error', 
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong' 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Token refresh scheduler (runs every hour)
cron.schedule('0 * * * *', async () => {
  try {
    console.log('🔄 Running scheduled token refresh...');
    await dropboxService.refreshTokenIfNeeded();
    console.log('✅ Token refresh completed');
  } catch (error) {
    console.error('❌ Scheduled token refresh failed:', error);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 DTF Backend API running on port ${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
  
  // Initialize token refresh on startup
  dropboxService.refreshTokenIfNeeded()
    .then(() => console.log('✅ Initial token check completed'))
    .catch(err => console.error('❌ Initial token check failed:', err));
});
