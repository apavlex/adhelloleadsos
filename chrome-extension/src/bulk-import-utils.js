(function (root) {
  'use strict';

  const BULK_IMPORT_BATCH_SIZE = 15;

  function mapCompanyToImportRow(company) {
    const utils = root.AdHelloAddressUtils;
    const address = String(company.Address || '').trim();
    const parsed = utils?.parseCityState
      ? utils.parseCityState(address)
      : { street: address, city: '', state: '' };
    const city = String(company.City || parsed.city || '').trim();
    const state = String(company.State || parsed.state || '').trim();
    const street = parsed.street || address;
    const fullAddress = city && state ? `${street}, ${city}, ${state}` : city ? `${street}, ${city}` : street;
    let snippet = String(company['Review Snippet'] || '').trim();
    if (snippet.startsWith('"') && snippet.endsWith('"')) snippet = snippet.slice(1, -1).trim();
    const website = String(company.Website || '').trim();
    const domain = utils?.hostnameFromUrl?.(website) || '';
    return {
      company_name: company['Business Name'] || '',
      phone_number: company['Phone Number'] || '',
      company_location: fullAddress || address,
      address: fullAddress || address,
      city,
      state,
      company_type: company.Category || '',
      category: company.Category || '',
      rating: company.Rating || '',
      review_count: String(company['Review Count'] || '').replace(/[^\d]/g, ''),
      review_snippet: snippet,
      sponsored: company.Sponsored || '',
      company_website: website,
      website,
      company_domain: domain,
      domain,
      google_maps_url: company['Google Maps URL'] || '',
      booking_url: company['Booking URL'] || '',
      source: 'chrome_extension_maps_bulk',
      source_channel: 'google_maps',
    };
  }

  function companiesToCsv(companies) {
    if (!companies?.length) return '';
    const headers = [
      'company_name',
      'phone_number',
      'company_location',
      'address',
      'city',
      'state',
      'company_type',
      'category',
      'rating',
      'review_count',
      'review_snippet',
      'sponsored',
      'company_website',
      'website',
      'company_domain',
      'domain',
      'google_maps_url',
      'booking_url',
      'source',
      'source_channel',
    ];
    const esc = (val) => {
      const s = val == null ? '' : String(val);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const rows = companies.map((c) => mapCompanyToImportRow(c));
    let csv = `${headers.join(',')}\n`;
    rows.forEach((row) => {
      csv += `${headers.map((h) => esc(row[h] ?? '')).join(',')}\n`;
    });
    return csv;
  }

  root.AdHelloBulkImport = {
    BULK_IMPORT_BATCH_SIZE,
    mapCompanyToImportRow,
    companiesToCsv,
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
