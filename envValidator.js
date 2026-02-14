// envValidator.js
const fs = require('fs');

/**
 * Valid source mode values
 */
const VALID_SOURCE_MODES = ['likes', 'comments', 'comment_free', 'followers', 'pod_guest', 'all'];

/**
 * Parses a boolean value from environment variable.
 * Accepts: true/false, TRUE/FALSE, 1/0, yes/no, YES/NO
 * 
 * @param {string} value - Raw environment variable value
 * @param {boolean} defaultValue - Default value if value is empty or undefined
 * @returns {boolean} Parsed boolean value
 */
function parseBoolean(value, defaultValue = false) {
  if (!value || typeof value !== 'string') {
    return defaultValue;
  }
  
  const normalized = value.trim().toLowerCase();
  
  // Accept true, 1, yes
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  
  // Accept false, 0, no
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  
  // Invalid value - return default
  return defaultValue;
}

/**
 * Validates and returns all required environment variables.
 * Performs strict upfront validation to fail fast with clear errors.
 * 
 * @returns {Object} Sanitized configuration object with:
 *   - instagramUsername: string
 *   - sheetId: string
 *   - sheetName: string
 *   - draftMessage: string
 *   - activateStatus: string
 *   - sourceMode: string (normalized lowercase)
 *   - maxDraft: number (parsed integer)
 *   - maxProcess: number (parsed integer)
 *   - detectConversation: boolean (parsed from DETECT_CONVERSATION)
 *   - sendMessage: boolean (parsed from SEND_MESSAGE, defaults to false)
 *   - enableFallback: boolean (parsed from ENABLE_FALLBACK, defaults to false)
 *   - fallbackStatus: string | null (required when enableFallback=true, null otherwise)
 * @throws {Error} If any required variable is missing or invalid
 */
function validateEnv() {
  const errors = [];

  // --- Validate INSTAGRAM_USERNAME ---
  const instagramUsername = process.env.INSTAGRAM_USERNAME;
  if (!instagramUsername || typeof instagramUsername !== 'string' || instagramUsername.trim() === '') {
    errors.push('INSTAGRAM_USERNAME is required and must be a non-empty string');
  }

  // --- Validate GOOGLE_SHEET_ID ---
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId || typeof sheetId !== 'string' || sheetId.trim() === '') {
    errors.push('GOOGLE_SHEET_ID is required and must be a non-empty string');
  }

  // --- Validate GOOGLE_SHEET_NAME ---
  const sheetName = process.env.GOOGLE_SHEET_NAME;
  if (!sheetName || typeof sheetName !== 'string' || sheetName.trim() === '') {
    errors.push('GOOGLE_SHEET_NAME is required and must be a non-empty string');
  }

  // --- Validate GOOGLE_CREDENTIALS or GOOGLE_CREDENTIALS_PATH ---
  const googleCredentials = process.env.GOOGLE_CREDENTIALS;
  const googleCredentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
  
  if (!googleCredentials && !googleCredentialsPath) {
    errors.push('Either GOOGLE_CREDENTIALS or GOOGLE_CREDENTIALS_PATH must be provided');
  } else {
    // If GOOGLE_CREDENTIALS is provided, validate it's valid JSON
    if (googleCredentials) {
      if (typeof googleCredentials !== 'string' || googleCredentials.trim() === '') {
        errors.push('GOOGLE_CREDENTIALS must be a non-empty JSON string');
      } else {
        try {
          JSON.parse(googleCredentials);
        } catch (parseError) {
          errors.push(`GOOGLE_CREDENTIALS is not valid JSON: ${parseError.message}`);
        }
      }
    }
    
    // If GOOGLE_CREDENTIALS_PATH is provided, validate file exists and is readable
    if (googleCredentialsPath) {
      if (typeof googleCredentialsPath !== 'string' || googleCredentialsPath.trim() === '') {
        errors.push('GOOGLE_CREDENTIALS_PATH must be a non-empty string');
      } else if (!fs.existsSync(googleCredentialsPath)) {
        errors.push(`GOOGLE_CREDENTIALS_PATH file not found: ${googleCredentialsPath}`);
      } else {
        try {
          const fileContent = fs.readFileSync(googleCredentialsPath, 'utf8');
          JSON.parse(fileContent);
        } catch (fileError) {
          errors.push(`GOOGLE_CREDENTIALS_PATH file is not readable or contains invalid JSON: ${fileError.message}`);
        }
      }
    }
  }

  // --- Validate DRAFT_MESSAGE ---
  const draftMessage = process.env.DRAFT_MESSAGE;
  if (!draftMessage || typeof draftMessage !== 'string' || draftMessage.trim() === '') {
    errors.push('DRAFT_MESSAGE is required and must be a non-empty string');
  }

  // --- Validate ACTIVATE_STATUS ---
  const activateStatus = process.env.ACTIVATE_STATUS;
  if (!activateStatus || typeof activateStatus !== 'string' || activateStatus.trim() === '') {
    errors.push('ACTIVATE_STATUS is required and must be a non-empty string');
  }

  // --- Validate SOURCE_MODE ---
  const sourceMode = process.env.SOURCE_MODE;
  if (!sourceMode || typeof sourceMode !== 'string' || sourceMode.trim() === '') {
    errors.push(`SOURCE_MODE is required and must be one of: ${VALID_SOURCE_MODES.join(', ')}`);
  } else {
    const normalizedSourceMode = sourceMode.trim().toLowerCase();
    if (!VALID_SOURCE_MODES.includes(normalizedSourceMode)) {
      errors.push(`SOURCE_MODE must be one of: ${VALID_SOURCE_MODES.join(', ')}. Received: "${sourceMode}"`);
    }
  }

  // --- Validate MAX_DRAFT ---
  const maxDraft = process.env.MAX_DRAFT;
  if (!maxDraft) {
    errors.push('MAX_DRAFT is required and must be a positive integer');
  } else {
    const trimmedMaxDraft = maxDraft.trim();
    // Check if it contains a decimal point (not an integer)
    if (trimmedMaxDraft.includes('.')) {
      errors.push(`MAX_DRAFT must be a positive integer (no decimals). Received: "${maxDraft}"`);
    } else {
      const parsedMaxDraft = parseInt(trimmedMaxDraft, 10);
      if (isNaN(parsedMaxDraft) || parsedMaxDraft < 1) {
        errors.push(`MAX_DRAFT must be a positive integer. Received: "${maxDraft}"`);
      }
    }
  }

  // --- Validate MAX_PROCCESS ---
  const maxProcess = process.env.MAX_PROCCESS;
  if (!maxProcess) {
    errors.push('MAX_PROCCESS is required and must be a positive integer');
  } else {
    const trimmedMaxProcess = maxProcess.trim();
    // Check if it contains a decimal point (not an integer)
    if (trimmedMaxProcess.includes('.')) {
      errors.push(`MAX_PROCCESS must be a positive integer (no decimals). Received: "${maxProcess}"`);
    } else {
      const parsedMaxProcess = parseInt(trimmedMaxProcess, 10);
      if (isNaN(parsedMaxProcess) || parsedMaxProcess < 1) {
        errors.push(`MAX_PROCCESS must be a positive integer. Received: "${maxProcess}"`);
      }
    }
  }

  // --- Parse DETECT_CONVERSATION (optional, defaults to false) ---
  const detectConversation = parseBoolean(process.env.DETECT_CONVERSATION, false);

  // --- Parse SEND_MESSAGE (optional, defaults to false) ---
  const sendMessage = parseBoolean(process.env.SEND_MESSAGE, false);

  // --- Parse ENABLE_FALLBACK (optional, defaults to false) ---
  const enableFallbackRaw = process.env.ENABLE_FALLBACK;
  let enableFallback = false;
  
  if (enableFallbackRaw !== undefined && enableFallbackRaw !== null) {
    const normalized = enableFallbackRaw.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'false') {
      enableFallback = normalized === 'true';
    } else {
      errors.push(`ENABLE_FALLBACK must be "true" or "false" (case-insensitive). Received: "${enableFallbackRaw}"`);
    }
  }

  // --- Validate FALLBACK_STATUS (required only when ENABLE_FALLBACK=true) ---
  const fallbackStatus = process.env.FALLBACK_STATUS;
  if (enableFallback) {
    if (!fallbackStatus || typeof fallbackStatus !== 'string' || fallbackStatus.trim() === '') {
      errors.push('FALLBACK_STATUS is required when ENABLE_FALLBACK=true');
    }
  }

  // --- Throw all errors at once if any found ---
  if (errors.length > 0) {
    const errorMessage = 'Environment validation failed:\n' + errors.map(err => `  - ${err}`).join('\n');
    throw new Error(errorMessage);
  }

  // --- Return sanitized configuration object ---
  return {
    instagramUsername: instagramUsername.trim(),
    sheetId: sheetId.trim(),
    sheetName: sheetName.trim(),
    draftMessage: draftMessage.trim(),
    activateStatus: activateStatus.trim(),
    sourceMode: process.env.SOURCE_MODE.trim().toLowerCase(),
    maxDraft: parseInt(process.env.MAX_DRAFT, 10),
    maxProcess: parseInt(process.env.MAX_PROCCESS, 10),
    detectConversation: detectConversation,
    sendMessage: sendMessage,
    enableFallback: enableFallback,
    fallbackStatus: enableFallback && fallbackStatus ? fallbackStatus.trim() : null,
  };
}

module.exports = {
  validateEnv,
  parseBoolean,
};

