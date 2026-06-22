/**
 * Serialize data for embedding in <script> tags without breaking HTML parsing.
 * Escapes <, >, &, U+2028/U+2029 which can break inline JSON.
 * @param {unknown} value
 * @returns {string}
 */
function safeJsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

module.exports = { safeJsonForScript };
