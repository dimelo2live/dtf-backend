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
      
      // Generate HTML content with proper location data
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
        locations: quoteData.locations, // Ensure locations are preserved
        total_transfers: quoteData.total_transfers,
        pricing: quoteData.pricing,
        file_path: filePath,
        last_updated: new Date().toISOString()
      };

      // Debug location data being saved
      console.log('📤 Saving quote data:', {
        id: quoteData.id,
        quote_name: quoteData.quote_name,
        customer_id: quoteData.customer_id,
        hasData: !!quoteData.data,
        dataKeys: quoteData.data ? Object.keys(quoteData.data) : []
      });

      console.log('💾 Saving metadata:', metadata);

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
   * Generate HTML content from quote data with proper location support
   */
  generateQuoteHtml(quoteData) {
    const data = quoteData.data || {};
    const locations = quoteData.locations || [];
    
    // Generate location HTML if locations exist
    let locationHtml = '';
    if (locations && locations.length > 0) {
      locationHtml = locations.map((location, index) => {
        const number = index + 1;
        const name = location.name || `Location ${number}`;
        const width = location.width || location.w || 0;
        const height = location.height || location.h || 0;
        const quantity = location.quantity || location.qty || location.q || 0;
        
        return `
          <div class="location-item">
            <div class="location-header">
              <span class="location-number">${number}</span>
              <span>${name}</span>
            </div>
            <div class="location-specs">
              <div class="location-spec">
                <div class="location-spec-label">Width</div>
                <div class="location-spec-value">${width}"</div>
              </div>
              <div class="location-spec">
                <div class="location-spec-label">Height</div>
                <div class="location-spec-value">${height}"</div>
              </div>
              <div class="location-spec">
                <div class="location-spec-label">Quantity</div>
                <div class="location-spec-value">${quantity}</div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } else {
      locationHtml = `
        <div class="location-item">
          <div class="location-header">
            <span class="location-number">!</span>
            <span>No Location Data</span>
          </div>
          <div style="font-size: 9px; color: #666; text-align: center; padding: 0.5rem 0;">
            Location information could not be loaded.
          </div>
        </div>
      `;
    }
    
    // Generate the full HTML template with proper location data
    let html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DTF Quote: ${quoteData.quote_name}</title>
  <style>
    @page {
      size: letter;
      margin: 0.5in;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    html, body { height: 100%; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 12px;
      line-height: 1.4;
      color: #333;
      background: #f5f7fb;
      margin: 0;
      padding: 24px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 100vh;
    }
    
    .quote-container {
      width: min(calc(8.5in - 1in), calc(100% - 48px));
      min-height: calc(11in - 1in);
      margin: 24px auto;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.08);
      padding: 0.5in;
      overflow-wrap: anywhere;
    }
    
    .quote-header {
      background: linear-gradient(135deg, #CF0F0F 0%, #8B0000 100%);
      color: white;
      padding: 1rem;
      margin-bottom: 1rem;
      border-radius: 8px;
      box-shadow: 0 2px 10px rgba(207, 15, 15, 0.2);
    }
    
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    
    .company-branding {
      flex: 1;
    }
    
    .company-name {
      font-size: 20px;
      font-weight: 700;
      margin: 0 0 0.2rem 0;
      letter-spacing: 0.5px;
    }
    
    .company-tagline {
      font-size: 11px;
      opacity: 0.9;
      margin: 0;
      font-style: italic;
    }
    
    .quote-title {
      font-size: 18px;
      font-weight: 600;
      text-align: right;
      margin: 0;
    }
    
    .header-bottom {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      opacity: 0.9;
    }
    
    .contact-info {
      display: flex;
      gap: 1rem;
    }
    
    .quote-meta {
      display: flex;
      gap: 1rem;
    }
    
    .quote-body {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    
    .quote-section {
      background: #f8f9fa;
      border-radius: 6px;
      padding: 0.75rem;
      border-left: 3px solid #CF0F0F;
      break-inside: avoid;
    }
    
    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #CF0F0F;
      margin: 0 0 0.5rem 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .data-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.3rem 0;
      border-bottom: 1px solid #e0e0e0;
      font-size: 11px;
    }
    
    .data-row:last-child {
      border-bottom: none;
    }
    
    .data-label {
      font-weight: 600;
      color: #666;
    }
    
    .data-value {
      font-weight: 700;
      color: #333;
      font-family: 'Courier New', monospace;
    }
    
    .highlight-value {
      color: #CF0F0F;
      font-size: 12px;
    }
    
    /* Location Display */
    .locations-section {
      grid-column: 1 / -1;
      background: #f0f8ff;
      border-left-color: #2196F3;
    }
    
    .locations-section .section-title {
      color: #2196F3;
    }
    
    .locations-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.5rem;
    }
    
    .location-item {
      background: white;
      padding: 0.5rem;
      border-radius: 4px;
      border: 1px solid #e0e0e0;
    }
    
    .location-header {
      font-weight: 700;
      color: #2196F3;
      font-size: 11px;
      margin-bottom: 0.3rem;
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    
    .location-number {
      background: #2196F3;
      color: white;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 8px;
      font-weight: 600;
    }
    
    .location-specs {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.3rem;
      font-size: 10px;
    }
    
    .location-spec {
      text-align: center;
      background: #f8f9fa;
      padding: 0.2rem;
      border-radius: 2px;
    }
    
    .location-spec-label {
      color: #666;
      font-weight: 600;
      font-size: 8px;
      text-transform: uppercase;
    }
    
    .location-spec-value {
      font-weight: 700;
      color: #333;
      font-size: 10px;
    }
    
    .pricing-summary {
      grid-column: 1 / -1;
      background: white;
      border: 2px solid #CF0F0F;
      border-radius: 8px;
      overflow: hidden;
      margin-top: 1rem;
    }
    
    .pricing-header {
      background: #CF0F0F;
      color: white;
      padding: 0.5rem 1rem;
      font-weight: 700;
      font-size: 13px;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    
    .pricing-body {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0;
    }
    
    .pricing-column {
      padding: 0.75rem;
      text-align: center;
      border-right: 1px solid #e0e0e0;
    }
    
    .pricing-column:last-child {
      border-right: none;
    }
    
    .pricing-label {
      font-size: 10px;
      color: #666;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 0.3rem;
    }
    
    .pricing-value {
      font-size: 16px;
      font-weight: 700;
      color: #333;
      font-family: 'Courier New', monospace;
    }
    
    .pricing-value.profit {
      color: #28a745;
    }
    
    .quote-footer {
      margin-top: 1rem;
      padding: 0.75rem;
      background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
      border-radius: 6px;
      border: 1px solid #dee2e6;
      text-align: center;
    }
    
    .footer-brand {
      font-size: 12px;
      font-weight: 700;
      color: #CF0F0F;
      margin-bottom: 0.3rem;
    }
    
    .footer-contact {
      font-size: 10px;
      color: #666;
      margin-bottom: 0.3rem;
    }
    
    .footer-message {
      font-size: 9px;
      color: #888;
      font-style: italic;
    }
    
    /* Print optimizations */
    @media print {
      body {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        background: white !important;
        padding: 0;
        display: block;
      }
      
      .quote-container {
        width: auto;
        min-height: auto;
        box-shadow: none;
        border: none;
        border-radius: 0;
        padding: 0;
      }
      
      .quote-header { padding: 0.75rem; margin-bottom: 0.75rem; }
      .quote-body { gap: 0.75rem; margin-bottom: 0.75rem; }
      .quote-section { padding: 0.6rem; }
      .data-row { padding: 0.25rem 0; }
      .pricing-summary { margin-top: 0.75rem; }
      .pricing-header { padding: 0.4rem 0.8rem; }
      .pricing-column { padding: 0.6rem; }
      .quote-footer { margin-top: 0.75rem; padding: 0.6rem; }

      .quote-section,
      .pricing-summary { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="quote-container">
    
    <!-- Modern Header -->
    <header class="quote-header">
      <div class="header-top">
        <div class="company-branding">
          <div class="company-name">DTF Rush Orders</div>
          <div class="company-tagline">Premium DTF Transfer Solutions</div>
        </div>
        <div class="quote-title">${quoteData.quote_name}</div>
      </div>
      <div class="header-bottom">
        <div class="contact-info">
          <span>📞 (954) 404-8103</span>
          <span>✉️ orders@dtfrushorders.com</span>
        </div>
        <div class="quote-meta">
          <span>${data.date_stamp || new Date().toLocaleDateString()}</span>
          <span>${data.loc_count || locations.length} Locations</span>
          <span>${data.total_transfers || quoteData.total_transfers} Transfers</span>
        </div>
      </div>
    </header>

    <!-- Content Body -->
    <div class="quote-body">
      
      <!-- Design Locations -->
      <section class="quote-section locations-section">
        <h3 class="section-title">📍 Design Locations</h3>
        <div class="locations-grid">
          ${locationHtml}
        </div>
      </section>
      
      <!-- Production Costs -->
      <section class="quote-section">
        <h3 class="section-title">🏭 Production Costs</h3>
        <div class="data-row">
          <span class="data-label">Imprint Cost</span>
          <span class="data-value">${data.imprint_cost || '$0.00'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Product Cost</span>
          <span class="data-value">${data.product_cost_total || '$0.00'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Press Cost</span>
          <span class="data-value">${data.press_cost_total || '$0.00'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Per Unit</span>
          <span class="data-value highlight-value">${data.unit_cost || '$0.00'}</span>
        </div>
      </section>

      <!-- Transfer Details -->
      <section class="quote-section">
        <h3 class="section-title">📦 Transfer Details</h3>
        <div class="data-row">
          <span class="data-label">Total Transfers</span>
          <span class="data-value">${data.total_transfers || quoteData.total_transfers || '0'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Cost per Transfer</span>
          <span class="data-value">${data.cost_per_transfer || '$0.00'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Sheet Length</span>
          <span class="data-value">${data.sheet_length || '0.00"'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Sheet Quantity</span>
          <span class="data-value">${data.sheet_qty || '0'}</span>
        </div>
      </section>

      <!-- Gang Sheet Info -->
      <section class="quote-section">
        <h3 class="section-title">📏 Gang Sheet Breakdown</h3>
        <div class="data-row" style="border-top: 1px solid #CF0F0F; padding-top: 0.5rem; margin-top: 0.5rem;">
          <span class="data-label">Total Sheet Cost</span>
          <span class="data-value highlight-value">${data.sheet_cost || '$0.00'}</span>
        </div>
      </section>

      <!-- Markup & Pricing -->
      <section class="quote-section">
        <h3 class="section-title">💰 Pricing & Markup</h3>
        <div class="data-row">
          <span class="data-label">Markup Percentage</span>
          <span class="data-value">${data.markup || '0'}%</span>
        </div>
        <div class="data-row">
          <span class="data-label">Retail Per Unit</span>
          <span class="data-value">${data.retail_unit || quoteData.pricing?.retail_unit || '$0.00'}</span>
        </div>
        <div class="data-row">
          <span class="data-label">Total Sale Price</span>
          <span class="data-value highlight-value">${data.retail_total || quoteData.pricing?.retail_total || '$0.00'}</span>
        </div>
        <div class="data-row" style="border-top: 2px solid #28a745; padding-top: 0.5rem; margin-top: 0.5rem;">
          <span class="data-label" style="color: #28a745; font-weight: 700;">Total Profit</span>
          <span class="data-value" style="color: #28a745; font-size: 14px;">${data.profit_total || quoteData.pricing?.profit_total || '$0.00'}</span>
        </div>
      </section>
      
    </div>

    <!-- Pricing Summary -->
    <div class="pricing-summary">
      <div class="pricing-header">💵 Quote Summary</div>
      <div class="pricing-body">
        <div class="pricing-column">
          <div class="pricing-label">Per Unit Price</div>
          <div class="pricing-value">${data.retail_unit || quoteData.pricing?.retail_unit || '$0.00'}</div>
        </div>
        <div class="pricing-column">
          <div class="pricing-label">Quantity</div>
          <div class="pricing-value">${data.total_transfers || quoteData.total_transfers || '0'}</div>
        </div>
        <div class="pricing-column">
          <div class="pricing-label">Total</div>
          <div class="pricing-value">${data.retail_total || quoteData.pricing?.retail_total || '$0.00'}</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <footer class="quote-footer">
      <div class="footer-brand">DTF Rush Orders - Premium DTF Transfer Solutions</div>
      <div class="footer-contact">📞 (954) 404-8103 • ✉️ orders@dtfrushorders.com</div>
      <div class="footer-message">Thank you for using our DTF Reseller Tool by DTF Rush Orders! Generated on ${data.date_stamp || new Date().toLocaleDateString()}</div>
    </footer>

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
