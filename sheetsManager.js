// sheetsManager.js
require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');

/**
 * Expected sheet column structure (in order)
 * 9 columns total: Session ID, Date Added, Username, Source, Date Sent, Message, Status, Name, Bio
 * Note: Name and Bio are optional (populated upstream) and not used by bot logic
 */
const REQUIRED_HEADERS = [
  'Session ID',
  'Date Added',
  'Username',
  'Source',
  'Date Sent',
  'Message',
  'Status'
];

/**
 * Column indices for easy reference (0-based)
 * Column order: Session ID (0), Date Added (1), Username (2), Source (3), Date Sent (4), Message (5), Status (6), Name (7), Bio (8)
 */
const COLUMN_INDICES = {
  SESSION_ID: 0,
  DATE_ADDED: 1,
  USERNAME: 2,
  SOURCE: 3,
  DATE_SENT: 4,
  MESSAGE: 5,
  STATUS: 6,
  NAME: 7,
  BIO: 8
};

/**
 * Loads and validates Google service account credentials from environment variables.
 * Prefers GOOGLE_CREDENTIALS (inline JSON string) over GOOGLE_CREDENTIALS_PATH (file path).
 * 
 * @returns {Object} Parsed credentials object
 * @throws {Error} If credentials are missing or invalid
 */
function loadCredentials() {
  let credentials = null;

  // Prefer inline credentials from .env
  if (process.env.GOOGLE_CREDENTIALS) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    } catch (parseError) {
      throw new Error(
        `Failed to parse GOOGLE_CREDENTIALS as JSON: ${parseError.message}. ` +
        `Ensure the value is a valid JSON string.`
      );
    }
  }
  // Fallback to credentials file
  else if (process.env.GOOGLE_CREDENTIALS_PATH) {
    if (!fs.existsSync(process.env.GOOGLE_CREDENTIALS_PATH)) {
      throw new Error(
        `GOOGLE_CREDENTIALS_PATH file not found: ${process.env.GOOGLE_CREDENTIALS_PATH}`
      );
    }

    try {
      const fileData = fs.readFileSync(process.env.GOOGLE_CREDENTIALS_PATH, 'utf8');
      credentials = JSON.parse(fileData);
    } catch (fileError) {
      throw new Error(
        `Failed to read or parse credentials file at ${process.env.GOOGLE_CREDENTIALS_PATH}: ${fileError.message}`
      );
    }
  }
  // Neither credential source provided
  else {
    throw new Error(
      'Missing Google credentials. Provide either GOOGLE_CREDENTIALS (JSON string) ' +
      'or GOOGLE_CREDENTIALS_PATH (file path) in environment variables.'
    );
  }

  // Validate credentials structure
  if (!credentials || typeof credentials !== 'object') {
    throw new Error('Invalid credentials: must be a JSON object');
  }

  if (!credentials.client_email || typeof credentials.client_email !== 'string') {
    throw new Error('Invalid credentials: missing or invalid client_email field');
  }

  if (!credentials.private_key || typeof credentials.private_key !== 'string') {
    throw new Error('Invalid credentials: missing or invalid private_key field');
  }

  return credentials;
}

/**
 * Validates that required environment variables are present.
 * 
 * @throws {Error} If required environment variables are missing
 */
function validateEnvironment() {
  if (!process.env.GOOGLE_SHEET_ID) {
    throw new Error('Missing required environment variable: GOOGLE_SHEET_ID');
  }

  if (!process.env.GOOGLE_SHEET_NAME) {
    throw new Error('Missing required environment variable: GOOGLE_SHEET_NAME');
  }
}

/**
 * Builds and returns an authenticated Google Sheets API client.
 * Loads credentials, validates environment, and creates a ready-to-use Sheets instance.
 * 
 * @returns {Object} Authenticated Google Sheets API client
 * @throws {Error} If authentication fails or environment is invalid
 */
async function buildSheetsClient() {
  validateEnvironment();
  const credentials = loadCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  return sheets;
}

/**
 * Validates that the sheet header row matches the expected structure.
 * 
 * @param {Array<string>} headerRow - Array of header values from the sheet
 * @throws {Error} If headers are missing, misordered, or mistyped
 */
function validateHeaders(headerRow) {
  if (!Array.isArray(headerRow)) {
    throw new Error('Header row must be an array');
  }

  if (headerRow.length < REQUIRED_HEADERS.length) {
    throw new Error(
      `Invalid sheet structure: expected ${REQUIRED_HEADERS.length} columns, ` +
      `found ${headerRow.length}. Required columns: ${REQUIRED_HEADERS.join(', ')}`
    );
  }

  for (let i = 0; i < REQUIRED_HEADERS.length; i++) {
    const expected = REQUIRED_HEADERS[i].trim();
    const actual = (headerRow[i] || '').trim();

    if (actual !== expected) {
      throw new Error(
        `Invalid sheet structure: column ${i + 1} (index ${i}) should be "${expected}", ` +
        `but found "${actual}". Ensure headers match exactly: ${REQUIRED_HEADERS.join(', ')}`
      );
    }
  }
}

/**
 * Loads all database rows from the configured Google Sheet.
 * Validates headers, converts rows to structured objects, and normalizes usernames.
 * 
 * @returns {Promise<Array<Object>>} Array of row objects with:
 *   - rowIndex: 1-based sheet row index
 *   - username: normalized lowercase username
 *   - source: source value from sheet
 *   - status: status value from sheet
 *   - rawRow: complete raw row array
 * @throws {Error} If sheet cannot be loaded or headers are invalid
 */
async function loadDatabaseRows() {
  validateEnvironment();
  const credentials = loadCredentials();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Fetch all values from the sheet (9 columns: A through I)
  const range = `${sheetName}!A:I`;
  let response;
  try {
    response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: range,
    });
  } catch (apiError) {
    throw new Error(
      `Failed to load sheet data: ${apiError.message}. ` +
      `Verify GOOGLE_SHEET_ID and GOOGLE_SHEET_NAME are correct and the service account has access.`
    );
  }

  const allRows = response.data.values || [];

  if (allRows.length === 0) {
    return [];
  }

  // Validate header row (first row)
  const headerRow = allRows[0];
  validateHeaders(headerRow);

  // Process data rows (skip header row)
  const dataRows = allRows.slice(1);
  const structuredRows = [];

  dataRows.forEach((row, index) => {
    // Skip completely blank rows
    if (!row || row.length === 0 || row.every(cell => !cell || cell.trim() === '')) {
      return;
    }

    // Ensure row has at least 7 columns (pad with empty strings if needed)
    // Name and Bio (columns 8-9) are optional
    while (row.length < 7) {
      row.push('');
    }

    // Extract values with safe defaults (using updated column indices)
    const sessionId = (row[COLUMN_INDICES.SESSION_ID] || '').trim();
    const username = (row[COLUMN_INDICES.USERNAME] || '').trim();
    const source = (row[COLUMN_INDICES.SOURCE] || '').trim();
    const status = (row[COLUMN_INDICES.STATUS] || '').trim();
    const message = (row[COLUMN_INDICES.MESSAGE] || '').trim();
    const name = (row[COLUMN_INDICES.NAME] || '').trim(); // Optional, for reference only
    const bio = (row[COLUMN_INDICES.BIO] || '').trim(); // Optional, for reference only

    // Normalize username to lowercase
    const normalizedUsername = username.toLowerCase();

    // Create structured object
    structuredRows.push({
      rowIndex: index + 2, // +2 because: 0-based index + 1 for header row + 1 for 1-based sheet indexing
      username: normalizedUsername,
      source: source,
      status: status,
      sessionId: sessionId, // Include session ID in structured data
      message: message, // Message text from sheet
      name: name, // Name (optional, for reference only)
      bio: bio, // Bio (optional, for reference only)
      rawRow: row, // Preserve full raw row array
    });
  });

  return structuredRows;
}

/**
 * Updates a single sheet row with draft metadata.
 * Updates Session ID, Date Sent, Message, and Status columns together.
 * 
 * Column order (9 columns total):
 *   A: Session ID (always updated)
 *   B: Date Added (preserved - never updated by this function)
 *   C: Username (preserved - never updated by this function)
 *   D: Source (preserved - never updated by this function)
 *   E: Date Sent (updated unless status is "Send Failed" or "Skipped")
 *   F: Message (updated unless status is "Send Failed" or "Skipped")
 *   G: Status (always updated)
 *   H: Name (preserved - never updated by this function, optional)
 *   I: Bio (preserved - never updated by this function, optional)
 * 
 * Special behavior:
 *   - For "Send Failed" and "Skipped" statuses:
 *     Date Sent and Message are preserved (not overwritten)
 *   - For all other statuses:
 *     Date Sent and Message are updated with provided values
 * 
 * @param {number} rowIndex - 1-based row index in the sheet
 * @param {string|number} sessionId - Session ID for this run (timestamp in ms)
 * @param {string} dateSent - ISO timestamp string for Date Sent column (can be empty string if not applicable)
 * @param {string} message - Message text to save (can be empty string)
 * @param {string} [status] - Status to set (defaults to "Drafted")
 * @throws {Error} If update fails or rowIndex is invalid
 */
async function updateDraftData(rowIndex, sessionId, dateSent, message, status = 'Drafted') {
  if (!Number.isInteger(rowIndex) || rowIndex < 2) {
    throw new Error(`Invalid rowIndex: ${rowIndex}. Must be an integer >= 2 (row 1 is header)`);
  }

  if (sessionId === undefined || sessionId === null || String(sessionId).trim() === '') {
    throw new Error('sessionId is required and must be a non-empty string or number');
  }

  if (typeof dateSent !== 'string') {
    throw new Error('dateSent must be a string (can be empty)');
  }

  if (typeof message !== 'string') {
    throw new Error('message must be a string');
  }

  if (typeof status !== 'string' || status.trim() === '') {
    throw new Error('status must be a non-empty string');
  }

  validateEnvironment();
  const credentials = loadCredentials();
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const sheetName = process.env.GOOGLE_SHEET_NAME;

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });

  // Update Session ID (column A), Date Sent (column E), Message (column F), Status (column G)
  // Range format: SheetName!A{row}:I{row} (9 columns total including optional Name/Bio)
  // We need to update: Session ID (A), Date Sent (E), Message (F), Status (G)
  // Columns B, C, D, H, I (Date Added, Username, Source, Name, Bio) are preserved
  
  // First, read the current row to preserve existing values
  const readRange = `${sheetName}!A${rowIndex}:I${rowIndex}`;
  let currentRow;
  try {
    const readResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: readRange,
    });
    currentRow = (readResponse.data.values && readResponse.data.values[0]) || [];
    // Pad to at least 7 columns if needed (Name/Bio are optional)
    while (currentRow.length < 7) {
      currentRow.push('');
    }
  } catch (readError) {
    // If row doesn't exist or can't be read, create a new row with empty values
    currentRow = ['', '', '', '', '', '', '', '', ''];
  }

  // Update only the columns we need to change:
  // Column A (Session ID), Column E (Date Sent), Column F (Message), Column G (Status)
  const updatedRow = [...currentRow];
  updatedRow[COLUMN_INDICES.SESSION_ID] = String(sessionId); // Column A: Session ID - always update
  
  // For certain statuses, preserve existing Date Sent and Message values
  const preserveDateAndMessage = status === 'Send Failed' || status === 'Skipped';
  
  if (preserveDateAndMessage) {
    // Preserve existing Date Sent and Message values
    // Only update Session ID and Status
    updatedRow[COLUMN_INDICES.DATE_SENT] = currentRow[COLUMN_INDICES.DATE_SENT] || ''; // Column E: Preserve existing Date Sent
    updatedRow[COLUMN_INDICES.MESSAGE] = currentRow[COLUMN_INDICES.MESSAGE] || ''; // Column F: Preserve existing Message
  } else {
    // Update Date Sent and Message with provided values
    updatedRow[COLUMN_INDICES.DATE_SENT] = dateSent; // Column E: Date Sent
    updatedRow[COLUMN_INDICES.MESSAGE] = message; // Column F: Message
  }
  
  updatedRow[COLUMN_INDICES.STATUS] = status; // Column G: Status - always update
  // Columns B, C, D, H, I (Date Added, Username, Source, Name, Bio) remain unchanged from currentRow

  // Update the entire row (all columns, preserving Name/Bio if present)
  const range = `${sheetName}!A${rowIndex}:I${rowIndex}`;
  const values = [updatedRow];

  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: range,
      valueInputOption: 'RAW',
      requestBody: {
        values: values,
      },
    });
  } catch (apiError) {
    throw new Error(
      `Failed to update row ${rowIndex} in sheet: ${apiError.message}. ` +
      `Verify rowIndex is valid and the service account has write access.`
    );
  }
}

module.exports = {
  buildSheetsClient,
  loadDatabaseRows,
  updateDraftData,
};
