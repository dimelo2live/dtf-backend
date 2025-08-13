const axios = require('axios');

class DropboxService {
  constructor() {
    this.appKey = process.env.DROPBOX_APP_KEY;
    this.appSecret = process.env.DROPBOX_APP_SECRET;
    this.refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
    this.accessToken = null;
    this.tokenExpiresAt = null;
    
    this.apiUrl = 'https://api.dropboxapi.com';
    this.contentApiUrl = 'https://content.dropboxapi.com';
    this.authUrl = 'https://api.dropbox.com';
    
    if (!this.appKey || !this.appSecret) {
      console.warn('⚠️  Dropbox credentials not fully configured. Check your .env file.');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken() {
    try {
      console.log('🔄 Refreshing Dropbox access token...');
      
      if (!this.appKey || !this.appSecret || !this.refreshToken) {
        throw new Error('Missing Dropbox OAuth credentials');
      }

      const response = await axios.post(`${this.authUrl}/oauth2/token`, new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.appKey,
        client_secret: this.appSecret
      }), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      const { access_token, expires_in } = response.data;
      
      this.accessToken = access_token;
      this.tokenExpiresAt = new Date(Date.now() + (expires_in * 1000));
      
      console.log(`✅ Token refreshed successfully. Expires at: ${this.tokenExpiresAt.toISOString()}`);
      
      return this.accessToken;
      
    } catch (error) {
      console.error('❌ Token refresh failed:', error.response?.data || error.message);
      throw new Error(`Failed to refresh token: ${error.message}`);
    }
  }

  /**
   * Check if token needs refresh and refresh if necessary
   */
  async refreshTokenIfNeeded() {
    // If no token or token expires in less than 10 minutes, refresh it
    const bufferTime = 10 * 60 * 1000; // 10 minutes in milliseconds
    
    if (!this.accessToken || !this.tokenExpiresAt || Date.now() >= (this.tokenExpiresAt.getTime() - bufferTime)) {
      await this.refreshAccessToken();
    }
    
    return this.accessToken;
  }

  /**
   * Get valid access token (refresh if needed)
   */
  async getValidToken() {
    await this.refreshTokenIfNeeded();
    return this.accessToken;
  }

  /**
   * Save quote to Dropbox
   */
  async saveQuote(quoteData, isUpdate = false) {
    try {
      const token = await this.getValidToken();
      const fileName = this.generateFileName(quoteData);
      const filePath = `/dtf-quotes/${fileName}`;
      
      // Generate HTML content
      const htmlContent = this.generateQuoteHtml(quoteData);
      
      // Upload HTML file
      const uploadResult = await this.uploadFile(filePath, htmlContent, token);
      
      // Create metadata
      const metadata = {
        id: quoteData.id,
        quote_name: quoteData.quote_name,
        customer_id: quoteData.customer_id,
        customer_email: quoteData.customer_email,
        date_created: quoteData.date_created,
        data: quoteData.data,
        locations: quoteData.locations,
        total_transfers: quoteData.total_transfers,
        pricing: quoteData.pricing,
        file_path: filePath,
        last_updated: new Date().toISOString()
      };

      // Save metadata
      const metadataPath = `/dtf-quotes/${quoteData.id}_metadata.json`;
      await this.uploadFile(metadataPath, JSON.stringify(metadata, null, 2), token);

      // Create shareable link
      let shareUrl = null;
      try {
        shareUrl = await this.createSharedLink(filePath, token);
      } catch (shareError) {
        console.warn('Could not create shared link:', shareError.message);
      }

      return {
        success: true,
        message: isUpdate ? 'Quote updated successfully' : 'Quote saved successfully',
        quote_id: quoteData.id,
        file_path: filePath,
        download_url: shareUrl,
        metadata: metadata
      };

    } catch (error) {
      console.error('Error saving quote:', error);
      throw new Error(`Failed to save quote: ${error.message}`);
    }
  }

  /**
   * Load quote from Dropbox
   */
  async loadQuote(quoteId, format = 'json') {
    try {
      const token = await this.getValidToken();
      const metadataPath = `/dtf-quotes/${quoteId}_metadata.json`;
      
      const metadataContent = await this.downloadFile(metadataPath, token);
      const metadata = JSON.parse(metadataContent);

      if (format === 'json') {
        return metadata;
      }

      // Return HTML content for printing
      const htmlContent = await this.downloadFile(metadata.file_path, token);
      return htmlContent;

    } catch (error) {
      console.error('Error loading quote:', error);
      throw new Error(`Failed to load quote: ${error.message}`);
    }
  }

  /**
   * Load all quotes for a customer
   */
  async loadCustomerQuotes(customerId) {
    try {
      const token = await this.getValidToken();
      
      // Scan Dropbox for metadata files
      const quotes = await this.scanDropboxQuotes(customerId, token);
      
      return quotes.map(quote => ({
        ...quote,
        date_created: new Date(quote.date_created).toLocaleDateString()
      }));

    } catch (error) {
      console.error('Error loading customer quotes:', error);
      return [];
    }
  }

  /**
   * Delete quote from Dropbox
   */
  async deleteQuote(quoteId, customerId = null) {
    try {
      const token = await this.getValidToken();
      
      // Get metadata first
      const metadata = await this.loadQuote(quoteId);
      
      // Delete HTML file
      await this.deleteFile(metadata.file_path, token);
      
      // Delete metadata file
      const metadataPath = `/dtf-quotes/${quoteId}_metadata.json`;
      await this.deleteFile(metadataPath, token);

      return {
        success: true,
        message: 'Quote deleted successfully',
        deleted_quote_id: quoteId
      };

    } catch (error) {
      console.error('Error deleting quote:', error);
      throw new Error(`Failed to delete quote: ${error.message}`);
    }
  }

  /**
   * Save customer logo
   */
  async saveCustomerLogo(customerId, logoData) {
    try {
      const token = await this.getValidToken();
      const logoMetadataPath = `/customer_logos/${customerId}/logo_metadata.json`;
      
      await this.uploadFile(logoMetadataPath, JSON.stringify(logoData, null, 2), token);
      
      return logoData;
    } catch (error) {
      throw new Error(`Failed to save logo metadata: ${error.message}`);
    }
  }

  /**
   * Load customer logo
   */
  async loadCustomerLogo(customerId) {
    try {
      const token = await this.getValidToken();
      const logoMetadataPath = `/customer_logos/${customerId}/logo_metadata.json`;
      
      const metadataContent = await this.downloadFile(logoMetadataPath, token);
      const logoData = JSON.parse(metadataContent);
      
      return logoData;
    } catch (error) {
      // No logo found is not an error
      return null;
    }
  }

  /**
   * Delete customer logo
   */
  async deleteCustomerLogo(customerId) {
    try {
      const token = await this.getValidToken();
      
      // Get current logo data
      const logoData = await this.loadCustomerLogo(customerId);
      
      if (logoData) {
        // Delete the actual logo file
        const logoPath = `/customer_logos/${customerId}/${logoData.filename}`;
        await this.deleteFile(logoPath, token);
        
        // Delete metadata
        const metadataPath = `/customer_logos/${customerId}/logo_metadata.json`;
        await this.deleteFile(metadataPath, token);
      }
      
      return { success: true, message: 'Logo deleted successfully' };
    } catch (error) {
      throw new Error(`Failed to delete logo: ${error.message}`);
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Generate filename for quote
   */
  generateFileName(quoteData) {
    const safeName = quoteData.quote_name.replace(/[^a-zA-Z0-9]/g, '_');
    return `${safeName}_${quoteData.id}.html`;
  }

  /**
   * Generate HTML content from quote data
   */
  generateQuoteHtml(quoteData) {
    // This is a simplified version - you'll need to implement based on your template
    const data = quoteData.data || {};
    
    let html = `
<!DOCTYPE html>
<html>
<head>
    <title>Quote: ${quoteData.quote_name}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { border-bottom: 2px solid #333; padding-bottom: 20px; }
        .quote-details { margin: 20px 0; }
        .pricing { background: #f5f5f5; padding: 15px; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>DTF Quote: ${quoteData.quote_name}</h1>
        <p>Customer: ${quoteData.customer_email}</p>
        <p>Date: ${new Date(quoteData.date_created).toLocaleDateString()}</p>
    </div>
    
    <div class="quote-details">
        <h2>Quote Details</h2>
        <p>Total Transfers: ${quoteData.total_transfers || 'N/A'}</p>
        
        ${Object.entries(data).map(([key, value]) => 
          `<p><strong>${key.replace(/_/g, ' ').toUpperCase()}:</strong> ${value}</p>`
        ).join('')}
    </div>
    
    <div class="pricing">
        <h2>Pricing</h2>
        ${quoteData.pricing ? Object.entries(quoteData.pricing).map(([key, value]) => 
          `<p><strong>${key.replace(/_/g, ' ').toUpperCase()}:</strong> $${value}</p>`
        ).join('') : '<p>Pricing information not available</p>'}
    </div>
</body>
</html>`;

    return html;
  }

  /**
   * Upload file to Dropbox
   */
  async uploadFile(path, content, token) {
    const response = await axios.post(`${this.contentApiUrl}/2/files/upload`, content, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Dropbox-API-Arg': JSON.stringify({
          path: path,
          mode: 'overwrite',
          autorename: false
        })
      }
    });

    return response.data;
  }

  /**
   * Download file from Dropbox
   */
  async downloadFile(path, token) {
    const response = await axios.post(`${this.contentApiUrl}/2/files/download`, null, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Dropbox-API-Arg': JSON.stringify({ path: path })
      }
    });

    return response.data;
  }

  /**
   * Delete file from Dropbox
   */
  async deleteFile(path, token) {
    const response = await axios.post(`${this.apiUrl}/2/files/delete_v2`, {
      path: path
    }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    return response.data;
  }

  /**
   * Create shared link for file
   */
  async createSharedLink(path, token) {
    try {
      // Try to create a new shared link
      const response = await axios.post(`${this.apiUrl}/2/sharing/create_shared_link_with_settings`, {
        path: path,
        settings: {
          requested_visibility: 'public',
          audience: 'public',
          access: 'viewer'
        }
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const shareUrl = response.data.url.replace('?dl=0', '?raw=1');
      return shareUrl;
      
    } catch (error) {
      // If link already exists, try to get existing ones
      try {
        const listResponse = await axios.post(`${this.apiUrl}/2/sharing/list_shared_links`, {
          path: path,
          direct_only: true
        }, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });

        if (listResponse.data.links && listResponse.data.links.length > 0) {
          return listResponse.data.links[0].url.replace('?dl=0', '?raw=1');
        }
      } catch (listError) {
        console.warn('Could not list existing shared links:', listError.message);
      }
      
      throw error;
    }
  }

  /**
   * Scan Dropbox for quote metadata files
   */
  async scanDropboxQuotes(customerId, token) {
    try {
      const response = await axios.post(`${this.apiUrl}/2/files/list_folder`, {
        path: '/dtf-quotes',
        recursive: false
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      const metadataFiles = response.data.entries.filter(entry => 
        entry.name.endsWith('_metadata.json')
      );

      const quotes = [];
      for (const file of metadataFiles) {
        try {
          const content = await this.downloadFile(file.path_lower, token);
          const metadata = JSON.parse(content);
          
          // Filter by customer ID
          if (metadata.customer_id == customerId) {
            quotes.push(metadata);
          }
        } catch (error) {
          console.warn(`Could not load metadata file ${file.name}:`, error.message);
        }
      }

      // Sort by date (newest first)
      quotes.sort((a, b) => new Date(b.date_created) - new Date(a.date_created));

      return quotes;

    } catch (error) {
      console.error('Error scanning Dropbox:', error);
      return [];
    }
  }
}

module.exports = DropboxService;
