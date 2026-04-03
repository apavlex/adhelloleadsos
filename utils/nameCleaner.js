/**
 * Normalizes a domain or business name into a friendly, Title Case display name.
 * Example: 'pressocoffee.co' -> 'Presso Coffee'
 * Example: 'https://www.apple.com/shop' -> 'Apple'
 */
function cleanBusinessName(input) {
  if (!input) return 'New Lead';

  let name = input.trim();

  // 1. If it looks like a URL/Domain, extract the primary part
  try {
    // Basic check for domain-like structure (contains a dot and no spaces)
    if (name.includes('.') && !name.includes(' ')) {
      let hostname = name;
      
      // Add protocol if missing for URL parsing
      if (!hostname.startsWith('http')) {
        hostname = 'https://' + hostname;
      }
      
      const url = new URL(hostname);
      name = url.hostname;
    }
  } catch (e) {
    // If URL parsing fails, stick with original string and proceed to cleaning
  }

  // 2. Strip common prefixes/suffixes
  name = name.replace(/^www\./i, '');
  
  // Split by common domain separators
  const parts = name.split('.');
  
  // If we have multiple parts (e.g. ['pressocoffee', 'co']), 
  // take the first one unless it's too short (like 'co.uk' -> 'co')
  // For now, let's take the first significant part.
  if (parts.length > 1) {
    // If first part is 'www', take second
    if (parts[0].toLowerCase() === 'www') {
      name = parts[1];
    } else {
      name = parts[0];
    }
  }

  const commonAcronyms = ['Llc', 'Inc', 'Corp', 'Ltd', 'Pllc'];
  
  // 3. Handle CamelCase and separators
  name = name
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Split CamelCase
    .replace(/([-_\.])/g, ' ')            // Replace hyphens/underscores/dots with space
    .split(' ')                           // Split into words
    .filter(Boolean)                      // Remove empty strings
    .map(word => {
      const capitalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      return commonAcronyms.includes(capitalized) ? capitalized.toUpperCase() : capitalized;
    }) // Title Case + Acronym handling
    .join(' ');

  return name || 'New Lead';
}

module.exports = { cleanBusinessName };
