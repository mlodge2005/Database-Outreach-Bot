// databaseLoader.js
require('dotenv').config();
const { loadDatabaseRows } = require('./sheetsManager');

/**
 * Valid source mode values
 */
const VALID_SOURCE_MODES = ['likes', 'comments', 'comment_free', 'followers', 'pod_guest', 'all'];

/**
 * Validates and normalizes the SOURCE_MODE environment variable.
 * 
 * @returns {string} Normalized source mode (lowercase)
 * @throws {Error} If SOURCE_MODE is missing or invalid
 */
function validateSourceMode() {
  const sourceMode = process.env.SOURCE_MODE;

  if (!sourceMode || typeof sourceMode !== 'string') {
    throw new Error(
      'Missing required environment variable: SOURCE_MODE. ' +
      `Valid values are: ${VALID_SOURCE_MODES.join(', ')}`
    );
  }

  const normalized = sourceMode.trim().toLowerCase();

  if (!VALID_SOURCE_MODES.includes(normalized)) {
    throw new Error(
      `Invalid SOURCE_MODE value: "${sourceMode}". ` +
      `Valid values are: ${VALID_SOURCE_MODES.join(', ')}`
    );
  }

  return normalized;
}

/**
 * Validates and parses the MAX_PROCCESS environment variable.
 * Note: Variable name uses "PROCCESS" spelling as specified.
 * 
 * @returns {number} Maximum number of entries to process
 * @throws {Error} If MAX_PROCCESS is missing or invalid
 */
function validateMaxProcess() {
  const maxProcess = process.env.MAX_PROCCESS;

  if (!maxProcess) {
    throw new Error(
      'Missing required environment variable: MAX_PROCCESS. ' +
      'Must be a positive integer.'
    );
  }

  const parsed = parseInt(maxProcess, 10);

  if (isNaN(parsed) || parsed < 1) {
    throw new Error(
      `Invalid MAX_PROCCESS value: "${maxProcess}". ` +
      'Must be a positive integer.'
    );
  }

  return parsed;
}

/**
 * Validates the ACTIVATE_STATUS environment variable.
 * Defaults to "Pending" if not provided (for backward compatibility).
 * 
 * @returns {string} Status value to filter by (defaults to "Pending")
 */
function validateActivateStatus() {
  const activateStatus = process.env.ACTIVATE_STATUS;

  if (!activateStatus || typeof activateStatus !== 'string' || activateStatus.trim() === '') {
    // Default to "Pending" if not provided
    return 'Pending';
  }

  return activateStatus.trim();
}

/**
 * Parses ENABLE_FALLBACK environment variable.
 * Accepts: "true"/"false" (case-insensitive). Anything else returns false.
 * 
 * @returns {boolean} True if ENABLE_FALLBACK is "true", false otherwise
 */
function parseEnableFallback() {
  const enableFallbackRaw = process.env.ENABLE_FALLBACK;
  
  if (enableFallbackRaw === undefined || enableFallbackRaw === null) {
    return false;
  }
  
  const normalized = enableFallbackRaw.trim().toLowerCase();
  return normalized === 'true';
}

/**
 * Validates FALLBACK_STATUS when fallback is enabled.
 * 
 * @returns {string | null} Fallback status value, or null if fallback disabled
 * @throws {Error} If fallback is enabled but FALLBACK_STATUS is missing
 */
function validateFallbackStatus() {
  const enableFallback = parseEnableFallback();
  
  if (!enableFallback) {
    return null;
  }
  
  const fallbackStatus = process.env.FALLBACK_STATUS;
  if (!fallbackStatus || typeof fallbackStatus !== 'string' || fallbackStatus.trim() === '') {
    throw new Error('FALLBACK_STATUS is required when ENABLE_FALLBACK=true');
  }
  
  return fallbackStatus.trim();
}

/**
 * Gets eligible rows filtered by status, source mode, and deduplicated by username.
 * Preserves row order and applies MAX_PROCCESS limit.
 * 
 * @param {Array<Object>} allRows - All rows from the database
 * @param {string} status - Status value to filter by
 * @param {string} sourceMode - Source mode to filter by (normalized lowercase)
 * @param {number} maxProcess - Maximum number of rows to return
 * @param {Set<string>} [excludeUsernames] - Set of usernames to exclude (for fallback deduplication)
 * @returns {Array<Object>} Filtered and deduplicated rows
 */
function getEligibleRowsByStatus(allRows, status, sourceMode, maxProcess, excludeUsernames = new Set()) {
  // Filter by status (exact match)
  const statusFiltered = allRows.filter(row => {
    if (!row || typeof row !== 'object') {
      return false;
    }
    
    const rowStatus = row.status;
    if (typeof rowStatus !== 'string') {
      return false;
    }
    
    return rowStatus.trim() === status;
  });
  
  // Filter by source mode
  let sourceFiltered;
  if (sourceMode === 'all') {
    sourceFiltered = statusFiltered;
  } else {
    sourceFiltered = statusFiltered.filter(row => {
      if (!row || typeof row !== 'object') {
        return false;
      }
      
      const rowSource = row.source;
      if (typeof rowSource !== 'string') {
        return false;
      }
      
      return rowSource.trim().toLowerCase() === sourceMode;
    });
  }
  
  // Deduplicate by username, excluding already selected usernames
  const seenUsernames = new Set(excludeUsernames);
  const deduplicated = [];
  
  for (const row of sourceFiltered) {
    if (!row || typeof row !== 'object') {
      continue;
    }
    
    const username = row.username;
    if (!username || typeof username !== 'string' || username.trim() === '') {
      continue;
    }
    
    const normalizedUsername = username.toLowerCase().trim();
    
    if (seenUsernames.has(normalizedUsername)) {
      continue;
    }
    
    seenUsernames.add(normalizedUsername);
    deduplicated.push(row);
  }
  
  // Apply MAX_PROCCESS limit
  return deduplicated.slice(0, maxProcess);
}

/**
 * Loads and filters database rows from Google Sheets with optional fallback status support.
 * 
 * Processing pipeline:
 * 1. Load all rows from sheetsManager
 * 2. Build primary candidate list (Status == ACTIVATE_STATUS)
 * 3. Apply source filter and deduplication to primary
 * 4. Apply MAX_PROCCESS limit to primary
 * 5. Select up to MAX_DRAFT from primary
 * 6. If fallback enabled and primary insufficient:
 *    - Build fallback candidate list (Status == FALLBACK_STATUS)
 *    - Apply same source filter and deduplication (excluding primary usernames)
 *    - Apply MAX_PROCCESS limit to fallback
 *    - Append fallback rows until total == MAX_DRAFT or fallback exhausted
 * 
 * @returns {Promise<Object>} Object with:
 *   - rows: Array of filtered and deduplicated row objects (up to MAX_DRAFT)
 *   - stats: Object with counts (primaryEligible, fallbackEligible, selectedPrimary, selectedFallback, totalSelected)
 * @throws {Error} If environment variables are invalid or data loading fails
 */
async function loadFilteredDatabase() {
  // Validate environment variables upfront
  const activateStatus = validateActivateStatus();
  const sourceMode = validateSourceMode();
  const maxProcess = validateMaxProcess();
  const enableFallback = parseEnableFallback();
  const fallbackStatus = validateFallbackStatus();
  const maxDraft = parseInt(process.env.MAX_DRAFT, 10);

  // --- STAGE 1: Load all rows from Google Sheets ---
  let allRows;
  try {
    allRows = await loadDatabaseRows();
  } catch (error) {
    throw new Error(
      `Failed to load database rows: ${error.message}`
    );
  }

  if (!Array.isArray(allRows)) {
    throw new Error(
      'loadDatabaseRows() did not return an array. ' +
      'Received: ' + typeof allRows
    );
  }

  // --- STAGE 2: Build primary candidate list ---
  const primaryEligible = getEligibleRowsByStatus(allRows, activateStatus, sourceMode, maxProcess);
  
  // --- STAGE 3: Select up to MAX_DRAFT from primary ---
  const selectedPrimary = primaryEligible.slice(0, maxDraft);
  const selectedPrimaryUsernames = new Set(
    selectedPrimary.map(row => row.username.toLowerCase().trim())
  );
  
  // --- STAGE 4: Build fallback candidate list if needed ---
  let fallbackEligible = [];
  let selectedFallback = [];
  
  if (enableFallback && selectedPrimary.length < maxDraft) {
    const remaining = maxDraft - selectedPrimary.length;
    
    // Get fallback candidates (excluding primary usernames)
    fallbackEligible = getEligibleRowsByStatus(
      allRows, 
      fallbackStatus, 
      sourceMode, 
      maxProcess, 
      selectedPrimaryUsernames
    );
    
    // Select up to remaining slots from fallback
    selectedFallback = fallbackEligible.slice(0, remaining);
  }
  
  // --- STAGE 5: Combine primary and fallback ---
  const finalRows = [...selectedPrimary, ...selectedFallback];
  
  // Return rows and statistics
  return {
    rows: finalRows,
    stats: {
      primaryEligible: primaryEligible.length,
      fallbackEligible: fallbackEligible.length,
      selectedPrimary: selectedPrimary.length,
      selectedFallback: selectedFallback.length,
      totalSelected: finalRows.length,
    },
  };
}

module.exports = {
  loadFilteredDatabase,
  getEligibleRowsByStatus, // Exported for testing
  parseEnableFallback, // Exported for testing
};







