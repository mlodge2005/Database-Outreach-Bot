// messageBuilder.js
// Message building utilities for first name extraction and message construction

const { getFirstName } = require('./conversationTools');
const logger = require('./logger');

/**
 * Extracts first name from Instagram DM page or derives from username.
 * Priority:
 * 1. Extract from DM page display name
 * 2. Derive from username (substring before _ or .)
 * 
 * @param {Object} options
 * @param {Object} options.page - Playwright Page object (DM thread)
 * @param {string} [options.username] - Instagram username (for fallback)
 * @returns {Promise<string>} First name string (empty if not found)
 */
async function extractFirstName(options = {}) {
  const { page, username = '' } = options;
  
  if (!page) {
    logger.warn('No page provided for first name extraction');
    return '';
  }

  try {
    // Try to extract from DM page
    logger.info('Attempting to extract first name from DM page...');
    const firstName = await getFirstName(page);
    
    if (firstName && firstName.trim()) {
      logger.success(`Extracted first name from page: ${firstName}`);
      return firstName.trim();
    }
    
    // Fallback: derive from username
    if (username) {
      logger.info(`First name not found on page, attempting to derive from username: ${username}`);
      const derivedName = deriveFirstNameFromUsername(username);
      
      if (derivedName) {
        logger.success(`Derived first name from username: ${derivedName}`);
        return derivedName;
      }
    }
    
    logger.warn('Could not extract or derive first name');
    return '';
  } catch (error) {
    logger.error(`Error extracting first name: ${error.message}`);
    
    // Try username fallback even on error
    if (username) {
      const derivedName = deriveFirstNameFromUsername(username);
      if (derivedName) {
        logger.info(`Using username-derived first name after error: ${derivedName}`);
        return derivedName;
      }
    }
    
    return '';
  }
}

/**
 * Derives a first name from username by taking substring before _ or .
 * Capitalizes the first letter.
 * 
 * @param {string} username - Instagram username
 * @returns {string} Derived first name or empty string
 */
function deriveFirstNameFromUsername(username) {
  if (!username || typeof username !== 'string') {
    return '';
  }
  
  const trimmed = username.trim();
  if (!trimmed) return '';
  
  // Find first separator (_ or .)
  const separatorIndex = Math.min(
    trimmed.indexOf('_') !== -1 ? trimmed.indexOf('_') : Infinity,
    trimmed.indexOf('.') !== -1 ? trimmed.indexOf('.') : Infinity
  );
  
  let namePart = '';
  if (separatorIndex !== Infinity && separatorIndex > 0) {
    namePart = trimmed.substring(0, separatorIndex);
  } else {
    // No separator found, use first part (up to reasonable length)
    namePart = trimmed.substring(0, 20);
  }
  
  // Clean and validate
  namePart = namePart.replace(/[^a-zA-Z0-9]/g, '');
  
  if (namePart.length < 2 || namePart.length > 30) {
    return '';
  }
  
  // Capitalize first letter
  return namePart.charAt(0).toUpperCase() + namePart.slice(1).toLowerCase();
}

/**
 * Builds a personalized draft message with optional first name.
 * Inserts first name (with leading space) before the first occurrence of the separator character in the message template.
 * If firstName is empty, returns messageTemplate as-is.
 * 
 * @param {Object} options
 * @param {string} [options.firstName] - First name to insert (optional)
 * @param {string} options.messageTemplate - Base message template
 * @param {string} [options.separator] - Separator character to find in message (default: "!")
 * @returns {string} Formatted message
 */
function buildDraftMessage(options = {}) {
  const { firstName = '', messageTemplate = '', separator = '!' } = options;
  
  if (!messageTemplate || typeof messageTemplate !== 'string') {
    logger.warn('No message template provided to buildDraftMessage');
    return messageTemplate || '';
  }
  
  const trimmedFirstName = firstName ? firstName.trim() : '';
  const trimmedTemplate = messageTemplate.trim();
  
  // If no first name, return template as-is
  if (!trimmedFirstName) {
    return trimmedTemplate;
  }
  
  // Find the first occurrence of the separator character in the message template
  const separatorIndex = trimmedTemplate.indexOf(separator);
  
  if (separatorIndex === -1) {
    // Separator not found, prepend first name with separator at the beginning
    return `${trimmedFirstName}${separator} ${trimmedTemplate}`;
  }
  
  // Insert first name (with leading space) before the first occurrence of the separator
  const beforeSeparator = trimmedTemplate.substring(0, separatorIndex);
  const afterSeparator = trimmedTemplate.substring(separatorIndex);
  const finalMessage = `${beforeSeparator} ${trimmedFirstName}${afterSeparator}`;
  
  return finalMessage;
}

module.exports = {
  extractFirstName,
  buildDraftMessage,
  deriveFirstNameFromUsername, // Exported for testing/debugging
};

