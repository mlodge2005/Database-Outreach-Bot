# Instagram DM Draft Automation

An automated Instagram direct message drafting system that reads user data from Google Sheets, opens DM interfaces, checks for existing conversations, and drafts personalized messages. The system uses Playwright for browser automation and integrates with Google Sheets API for data management.

## Features

- **Automated DM Drafting**: Opens Instagram DM interfaces and drafts personalized messages
- **Google Sheets Integration**: Reads user data and updates status in real-time
- **Optional Conversation Detection**: Configurable check for existing conversations before drafting
- **Optional First Name Personalization**: Automatically extracts and prepends first names to messages
- **Multi-Flow DM Opening**: Uses multiple strategies to open DM interfaces reliably
- **Persistent Browser Sessions**: Maintains login state across runs
- **Status Tracking**: Updates Google Sheets with draft status, timestamps, and error messages
- **Filtering & Deduplication**: Processes only eligible users based on status and source
- **Dry Run Mode**: Test the system without making changes

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn
- Google Service Account with Sheets API access
- Instagram account
- Google Sheet with the required structure (see below)

## Installation

1. Clone or download this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your `.env` file (see Configuration section)
4. Run the login seeder to establish a browser session:
   ```bash
   node loginSeeder.js
   ```

## Configuration

Create a `.env` file in the project root with the following variables:

### Required Environment Variables

```env
# Instagram Configuration
INSTAGRAM_USERNAME=your_instagram_username

# Google Sheets Configuration
GOOGLE_SHEET_ID=your_sheet_id_here
GOOGLE_SHEET_NAME=Sheet1

# Google Service Account Credentials (choose one)
# Option 1: Inline JSON string (paste your full service account JSON here)
# Get this from Google Cloud Console > IAM & Admin > Service Accounts
GOOGLE_CREDENTIALS='{"type":"service_account","project_id":"your-project-id-here",...}'
# Option 2: Path to credentials JSON file (recommended - more secure)
GOOGLE_CREDENTIALS_PATH=./path/to/your-credentials-file.json

# Message Template
DRAFT_MESSAGE=Your message template here. The system will automatically insert first names using the existing name insertion logic.

# Filtering Configuration
ACTIVATE_STATUS=Pending
SOURCE_MODE=all
# Valid SOURCE_MODE values: likes, comments, comment_free, followers, pod_guest, all

# Fallback Status (Optional)
# Enable fallback to backfill from a second status pool if primary pool is insufficient
ENABLE_FALLBACK=false
# Valid ENABLE_FALLBACK values: true, false (case-insensitive)
# FALLBACK_STATUS is required when ENABLE_FALLBACK=true
FALLBACK_STATUS=Secondary
# Example: If ACTIVATE_STATUS="Pending" has only 5 rows but MAX_DRAFT=10,
# and ENABLE_FALLBACK=true with FALLBACK_STATUS="Secondary",
# the system will select 5 from "Pending" and 5 from "Secondary" to reach MAX_DRAFT

# Processing Limits
MAX_DRAFT=10
MAX_PROCCESS=100

# Optional Features
# Conversation Detection - If true, checks for existing conversations before drafting
DETECT_CONVERSATION=false

# Send Message - If true, automatically sends drafted messages (default: false)
SEND_MESSAGE=false
```

### Google Sheet Structure

Your Google Sheet must have the following columns in this exact order:

1. **Date Added** - When the user was added to the sheet
2. **Username** - Instagram username (will be normalized to lowercase)
3. **Source** - Source of the user (likes, comments, followers, etc.)
4. **Date Sent** - Automatically updated when message is drafted
5. **Message** - Automatically updated with the drafted message text
6. **Status** - Automatically updated (Pending → Drafted, Convo Exists, Failed)

### Google Sheets Setup

1. Create a Google Service Account in the [Google Cloud Console](https://console.cloud.google.com/)
2. Enable the Google Sheets API
3. Download the service account JSON key
4. Share your Google Sheet with the service account email (grant "Editor" access)
5. Add the credentials to your `.env` file (either inline JSON or file path)

## Usage

### Step 1: Initial Login Setup

Before running the automation, establish a browser session:

```bash
node loginSeeder.js
```

This will:
- Launch a browser window
- Navigate to Instagram
- Wait for you to log in manually
- Save the session to `./browser-data` for future use

**Press ENTER in the terminal when you've completed login.**

### Step 2: Run the Automation

```bash
node main.js
```

### Dry Run Mode

Test the system without making changes:

```bash
node main.js --dry-run
```

This will:
- Validate environment variables
- Load and filter database rows
- Show which users would be processed
- **Not** launch a browser or update Google Sheets

## How It Works

1. **Environment Validation**: Validates all required environment variables
2. **Data Loading**: Loads all rows from Google Sheets
3. **Filtering with Fallback Support**: 
   - Primary pool: Filters rows by `ACTIVATE_STATUS` and `SOURCE_MODE`
   - If `ENABLE_FALLBACK=true` and primary pool insufficient:
     * Fallback pool: Filters rows by `FALLBACK_STATUS` and `SOURCE_MODE`
     * Excludes usernames already selected from primary pool
     * Backfills up to `MAX_DRAFT` total rows
4. **Deduplication**: Removes duplicate usernames (keeps first occurrence, preserves order)
5. **Processing Limit**: Respects `MAX_PROCCESS` limit for both primary and fallback pools
6. **Browser Initialization**: Launches browser with persistent session
7. **User Processing**: For each user:
   - Creates a new browser tab
   - Navigates to user's Instagram profile
   - Opens DM interface (tries multiple methods)
   - Checks for existing conversation (if DETECT_CONVERSATION=true)
   - Extracts first name from profile
   - Drafts personalized message using `DRAFT_MESSAGE` template with name insertion
   - Updates Google Sheet with status
   - Keeps tab open if successful, closes if failed or skipped
8. **Status Updates**: Updates Google Sheet with:
   - **Drafted**: Message successfully drafted (includes final message text with name)
   - **Skipped**: Existing conversation detected (only if DETECT_CONVERSATION=true)
   - **Failed**: Error occurred during processing

## Project Structure

```
.
├── main.js                   # Main orchestrator script
├── loginSeeder.js            # Initial login session setup
├── envValidator.js           # Environment variable validation
├── sheetsManager.js          # Google Sheets API integration
├── databaseLoader.js         # Data filtering and deduplication
├── logger.js                 # Structured logging utility
├── dmFlowController.js       # DM opening orchestrator
├── flow1_directMessage.js    # Primary DM opening method
├── flow2_optionsMenu.js      # Fallback DM opening method
├── conversationDetector.js   # Detects existing conversations
├── conversationTools.js      # Conversation utilities
├── messageBuilder.js         # Message building utilities (first name extraction, message construction)
├── messageDrafter.js         # Message drafting logic
├── nameExtractor.js          # Extracts first name from profiles (legacy, now uses messageBuilder)
├── utils.js                  # Shared utility functions
└── browser-data/             # Persistent browser session data
```

## Status Values

The system updates the **Status** column in your Google Sheet with:

- **Pending**: Initial status (users ready to be processed)
- **Drafted**: Message successfully drafted in DM interface (includes final message with first name if enabled)
- **Skipped (Existing Conversation)**: User already has an existing conversation (only set when DETECT_CONVERSATION=true)
- **Failed**: Error occurred (e.g., DM interface couldn't be opened)

## Error Handling

- Individual user failures don't crash the entire process
- Errors are logged with detailed messages
- Failed users are marked with "Failed" status in the sheet
- Browser tabs for failed users are automatically closed
- Only successfully drafted tabs remain open for manual review

## Logging

The system uses structured logging with timestamps. Logs include:
- Environment validation status
- Database loading progress
- Filtering results
- User processing status
- Success/failure messages
- Error details

Optional file logging can be enabled by setting `ENABLE_FILE_LOGGING=true` in your `.env` file. Logs will be written to `automation.log`.

## Optional Features

### Conversation Detection

Set `DETECT_CONVERSATION=true` in your `.env` file to enable automatic conversation detection. When enabled:
- The system checks for existing conversations before drafting
- Users with existing conversations are skipped
- Status is set to "Skipped (Existing Conversation)"
- No message is drafted for skipped users
- Tabs for skipped users are closed immediately

### Fallback Status Feature

Set `ENABLE_FALLBACK=true` in your `.env` file to enable fallback status backfilling. When enabled:
- Primary pool: Selects rows where Status == `ACTIVATE_STATUS`
- If primary pool has fewer rows than `MAX_DRAFT`:
  * Fallback pool: Selects rows where Status == `FALLBACK_STATUS`
  * Excludes usernames already selected from primary pool
  * Backfills remaining slots up to `MAX_DRAFT` total
- Both pools apply the same `SOURCE_MODE` filtering
- Both pools respect `MAX_PROCCESS` limit
- Deduplication preserves row order and prevents duplicates across pools

**Example:**
- `ACTIVATE_STATUS="Pending"`, `FALLBACK_STATUS="Secondary"`, `MAX_DRAFT=10`
- If "Pending" has 5 eligible rows and "Secondary" has 8 eligible rows:
  * Selects all 5 from "Pending"
  * Selects 5 from "Secondary" (excluding any duplicates)
  * Total: 10 rows ready for drafting

### First Name Personalization

The system automatically extracts first names and inserts them into `DRAFT_MESSAGE`:
- First name is extracted from Instagram profile (or derived from username)
- Message format: `{firstName}! {DRAFT_MESSAGE}` (separator: "!")
- Example: "John! What's up! Great seeing you here..."
- If no first name is found, uses `DRAFT_MESSAGE` as-is

**First Name Extraction Priority:**
1. Instagram profile display name (via DM page)
2. Derived from username (substring before `_` or `.`)

## Limitations & Considerations

- **Rate Limiting**: Instagram may rate-limit automated actions. The system includes human-like delays to minimize this risk.
- **Account Safety**: Use responsibly. Excessive automation may result in account restrictions.
- **Session Expiry**: Browser sessions may expire. Re-run `loginSeeder.js` if authentication fails.
- **DM Restrictions**: Some users may have DM restrictions that prevent message drafting.
- **First Name Extraction**: May not always find a valid first name. Falls back to username-derived name or uses message template as-is.

## Troubleshooting

### "Not logged in" error
- Run `loginSeeder.js` to establish a new session
- Check that `./browser-data` directory exists and contains session data

### "Permission denied" for Google Sheets
- Ensure the service account email has "Editor" access to the sheet
- Verify `GOOGLE_SHEET_ID` is correct
- Check that credentials are valid JSON

### "No rows match the filter criteria"
- Verify `ACTIVATE_STATUS` matches the Status column values in your sheet
- Check that `SOURCE_MODE` matches Source column values (or use "all")
- Ensure your sheet has rows with the correct status

### DM interface not opening
- Some users may have privacy settings that block DMs
- The system will mark these as "Failed" and continue
- Check the logs for specific error messages

## License

ISC

## Support

For issues or questions, review the logs and ensure all environment variables are correctly configured.

