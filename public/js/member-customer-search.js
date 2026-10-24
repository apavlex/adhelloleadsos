/**
 * Customer typeahead ranking — keep behavior aligned with lib/customerSearch.js
 * (UMD so Node tests and the member app share one implementation).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.maCustomerSearch = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function digits(value) {
    return String(value == null ? '' : value).replace(/\D+/g, '');
  }

  function norm(value) {
    return String(value == null ? '' : value)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function scoreCustomer(customer, query) {
    const q = norm(query);
    if (!q) return 1;
    const name = norm(customer && customer.name);
    const email = norm(customer && customer.email);
    const phone = digits(customer && customer.phone);
    const qDigits = digits(q);
    let score = 0;

    if (name) {
      if (name === q) score = Math.max(score, 1000);
      else if (name.startsWith(q)) score = Math.max(score, 800);
      else if (name.includes(' ' + q) || name.includes(q)) {
        const wordHit = name.split(/[^a-z0-9]+/).some(function (w) { return w.indexOf(q) === 0; });
        score = Math.max(score, wordHit ? 600 : 400);
      }
    }

    // Match from the first digit typed so phone search feels instant.
    if (qDigits.length >= 1 && phone && phone.indexOf(qDigits) !== -1) {
      score = Math.max(score, phone.indexOf(qDigits) === 0 || phone.slice(-qDigits.length) === qDigits ? 700 : 500);
    }

    if (email) {
      if (email.indexOf(q) === 0 || email.split('@')[0].indexOf(q) === 0) score = Math.max(score, 550);
      else if (email.indexOf(q) !== -1) score = Math.max(score, 300);
    }

    const address = norm(customer && customer.address);
    if (address && address.indexOf(q) !== -1) {
      score = Math.max(score, address.indexOf(q) === 0 ? 450 : 280);
    }

    if (score > 0 && name) score += Math.max(0, 40 - Math.min(name.length, 40)) / 100;
    return score;
  }

  function searchCustomers(customers, query, opts) {
    const list = Array.isArray(customers) ? customers : [];
    const limit = Math.max(1, Math.min(100, Number(opts && opts.limit) || 40));
    const q = norm(query);
    return list
      .map(function (c, index) { return { c: c, index: index, score: scoreCustomer(c, q) }; })
      .filter(function (row) { return q ? row.score > 0 : true; })
      .sort(function (a, b) { return b.score - a.score || a.index - b.index; })
      .slice(0, limit)
      .map(function (row) { return row.c; });
  }

  return { digits: digits, norm: norm, scoreCustomer: scoreCustomer, searchCustomers: searchCustomers };
});
