// main.js
// Main orchestrator for Instagram Draft Message Automation

require('dotenv').config();
const { chromium } = require('playwright');
const { performance } = require('perf_hooks');
const { validateEnv } = require('./envValidator');
const { loadDatabaseRows } = require('./sheetsManager');
const { loadFilteredDatabase } = require('./databaseLoader');
const { updateDraftData } = require('./sheetsManager');
const { openDMController } = require('./dmFlowController');
const { detectExistingConversation } = require('./conversationDetector');
const { draftMessage } = require('./messageDrafter');
const { extractFirstName, buildDraftMessage } = require('./messageBuilder');
const { humanDelay } = require('./utils');
const logger = require('./logger');

/**
 * Checks if dry-run mode is enabled via CLI flag
 * @returns {boolean} True if --dry-run flag is present
 */
function isDryRun() {
  return process.argv.includes('--dry-run');
}

/**
 * Generates a unique session ID for this run.
 * Uses timestamp in milliseconds for uniqueness.
 * 
 * @returns {number} Session ID as timestamp in milliseconds
 */
function createSessionId() {
  return Date.now();
}

/**
 * Formats a duration in milliseconds into a human-readable string.
 * Format: "Xm Y.ZZs" (minutes, seconds with 2 decimal places)
 * 
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration string (e.g., "3m 12.48s")
 */
function formatRunDuration(ms) {
  if (typeof ms !== 'number' || isNaN(ms) || ms < 0) {
    return '0s';
  }
  
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes > 0) {
    // Format with 2 decimal places for seconds
    return `${minutes}m ${seconds.toFixed(2)}s`;
  } else {
    // If less than a minute, just show seconds
    return `${seconds.toFixed(2)}s`;
  }
}

/**
 * Initializes browser with persistent context
 * @returns {Promise<Object>} { browser } - Browser context (no page created)
 */
async function initializeBrowser() {
  logger.info('Launching browser with persistent context...');
  
  const browser = await chromium.launchPersistentContext('./browser-data', {
    headless: false,
    viewport: null, // Use full screen size
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized'
    ]
  });
  
  logger.success('Browser launched successfully');
  
  return { browser };
}

/**
 * Navigates to a user's Instagram profile page
 * @param {Object} page - Playwright page object
 * @param {string} username - Instagram username to navigate to
 */
async function navigateToProfile(page, username) {
  const profileUrl = `https://www.instagram.com/${username}/`;
  logger.info(`Navigating to profile: ${profileUrl}`);
  
  await page.goto(profileUrl, { waitUntil: 'domcontentloaded' });
  await humanDelay(1500, 2500);
  
  // Check if redirected to login page
  const loginInput = await page.$('input[name="username"]');
  if (loginInput) {
    throw new Error('Not logged in - redirected to login page. Run loginSeeder.js first.');
  }
  
  logger.success(`Successfully navigated to ${username}'s profile`);
}

/**
 * Processes a single user: opens DM, checks conversation, drafts message, optionally sends
 * @param {Object} page - Playwright page object
 * @param {Object} row - User row data from database (must include username and message)
 * @param {Object} config - Configuration object with detectConversation, sendMessage
 * @returns {Promise<Object>} Result object with success status and details
 */
async function processUser(page, row, config) {
  const { username, rowIndex } = row;
  const result = {
    username,
    rowIndex,
    success: false,
    skipped: false,
    error: null,
    message: null,
  };
  
  try {
    // Validate username before proceeding
    if (!username || typeof username !== 'string' || username.trim() === '') {
      result.error = 'Username is required and must be non-empty';
      logger.error(`Validation failed for row ${rowIndex}: ${result.error}`);
      return result;
    }
    
    // Validate DRAFT_MESSAGE template
    if (!config.draftMessage || typeof config.draftMessage !== 'string' || config.draftMessage.trim() === '') {
      result.error = 'DRAFT_MESSAGE is required and must be non-empty';
      logger.error(`Validation failed for ${username} (row ${rowIndex}): ${result.error}`);
      return result;
    }
    
    // Navigate to user's profile
    await navigateToProfile(page, username);
    
    // Open DM interface
    logger.info(`Opening DM for ${username}...`);
    const dmResult = await openDMController(page);
    
    if (!dmResult.success) {
      result.error = `Failed to open DM: ${dmResult.error || 'Unknown error'}`;
      logger.error(`Failed to open DM for ${username}: ${result.error}`);
      return result;
    }
    
    logger.success(`DM opened for ${username} (method: ${dmResult.used})`);
    
    // Wait a bit for DM to fully load
    await humanDelay(1000, 2000);
    
    // Check for existing conversation (if enabled)
    if (config.detectConversation) {
      logger.info(`Checking for existing conversation with ${username}...`);
      const conversationResult = await detectExistingConversation(page);
      
      if (conversationResult.hasConversation) {
        result.skipped = true;
        result.error = `Existing conversation detected (${conversationResult.messageCount} messages)`;
        logger.warn(`Skipping ${username}: ${result.error}`);
        return result;
      }
      
      logger.info(`No existing conversation found for ${username}`);
    } else {
      logger.info(`Conversation detection disabled - proceeding to draft message`);
    }
    
    // Extract first name and build message with name insertion
    logger.info(`Extracting first name for ${username}...`);
    const firstName = await extractFirstName({ page, username });
    
    // Build message using DRAFT_MESSAGE template with name insertion
    const messageText = buildDraftMessage({
      firstName: firstName,
      messageTemplate: config.draftMessage,
      separator: '!', // Default separator as per existing logic
    });
    
    logger.info(`Built message for ${username}${firstName ? ` (with name: ${firstName})` : ''}`);
    
    // Draft the message (and optionally send it)
    logger.info(`Drafting message for ${username}...`);
    const draftResult = await draftMessage(page, {
      messageText: messageText, // Use DRAFT_MESSAGE template with name insertion
      sendMessage: config.sendMessage,
    });
    
    if (!draftResult.success) {
      result.error = `Failed to draft message: ${draftResult.error || 'Unknown error'}`;
      logger.error(`Failed to draft message for ${username}: ${result.error}`);
      return result;
    }
    
    result.success = true;
    result.message = draftResult.message;
    
    // Track send status if SEND_MESSAGE is enabled
    if (config.sendMessage) {
      result.sent = draftResult.sent || false;
      if (result.sent) {
        logger.success(`Message drafted and sent successfully for ${username}`);
      } else {
        logger.error(`Message drafted but sending failed for ${username}`);
        result.error = 'Message send failed - bubble not detected after retry';
      }
    } else {
      logger.success(`Message drafted successfully for ${username} (not sent)`);
    }
    
    return result;
    
  } catch (error) {
    result.error = error.message || String(error);
    logger.error(`Error processing ${username}: ${result.error}`);
    return result;
  }
}

/**
 * Main orchestrator function
 */
async function run() {
  let browser = null;
  let config = null;
  
  // --- STEP 0: Initialize Run Timing and Session ID ---
  // Capture high-precision start time at the very beginning
  const runStartTime = performance.now();
  
  // Generate session ID at the very start, before any processing
  const sessionId = createSessionId();
  logger.section('Session Initialization');
  logger.info(`Session ID: ${sessionId}`);
  
  try {
    // Check for dry-run mode
    const dryRun = isDryRun();
    if (dryRun) {
      logger.section('DRY RUN MODE - No browser or sheet updates will occur');
    }
    
    // --- STEP 1: Validate Environment ---
    logger.section('Environment Validation');
    try {
      config = validateEnv();
      logger.success('Environment validation passed');
      logger.info(`Instagram username: ${config.instagramUsername}`);
      logger.info(`Sheet: ${config.sheetName} (ID: ${config.sheetId})`);
      logger.info(`Source mode: ${config.sourceMode}`);
      logger.info(`Activate status: ${config.activateStatus}`);
      if (config.enableFallback) {
        logger.info(`Fallback enabled: true`);
        logger.info(`Fallback status: ${config.fallbackStatus}`);
      } else {
        logger.info(`Fallback enabled: false`);
      }
      logger.info(`Max draft: ${config.maxDraft}`);
      logger.info(`Max process: ${config.maxProcess}`);
      logger.info(`Detect conversation: ${config.detectConversation}`);
      logger.info(`Send message: ${config.sendMessage}`);
    } catch (error) {
      logger.error(`Environment validation failed: ${error.message}`);
      throw error;
    }
    
    // --- STEP 2: Load All Rows ---
    logger.section('Loading Database Rows');
    let allRows;
    try {
      allRows = await loadDatabaseRows();
      logger.info(`Loaded ${allRows.length} total rows from Google Sheets`);
    } catch (error) {
      logger.error(`Failed to load database rows: ${error.message}`);
      throw error;
    }
    
    // --- STEP 3: Filter + Dedupe ---
    logger.section('Filtering and Deduplication');
    let filteredRows;
    let filterStats;
    try {
      const filterResult = await loadFilteredDatabase();
      filteredRows = filterResult.rows;
      filterStats = filterResult.stats;
      
      logger.info(`Primary eligible: ${filterStats.primaryEligible} rows`);
      if (config.enableFallback) {
        logger.info(`Fallback eligible: ${filterStats.fallbackEligible} rows`);
        logger.info(`Selected from primary: ${filterStats.selectedPrimary} rows`);
        logger.info(`Selected from fallback: ${filterStats.selectedFallback} rows`);
      }
      logger.info(`Total selected: ${filterStats.totalSelected} rows ready for processing`);
      
      if (filteredRows.length === 0) {
        logger.warn('No rows match the filter criteria. Exiting.');
        // Capture end time and show summary even on early exit
        const runEndTime = performance.now();
        const runDurationMs = runEndTime - runStartTime;
        logger.section('Final Summary');
        logger.info(`Session ID: ${sessionId}`);
        logger.info(`Total users processed: 0`);
        logger.info(`Run Duration: ${formatRunDuration(runDurationMs)}`);
        return;
      }
    } catch (error) {
      logger.error(`Failed to filter database: ${error.message}`);
      throw error;
    }
    
    // --- STEP 4: Initialize Browser (skip in dry-run) ---
    if (dryRun) {
      logger.section('Dry Run - Skipping Browser Initialization');
      logger.info('Would process the following users:');
      const wouldProcess = filteredRows.slice(0, config.maxDraft);
      wouldProcess.forEach((row, index) => {
        logger.info(`  ${index + 1}. ${row.username} (row ${row.rowIndex})`);
      });
      
      // Capture end time and show summary for dry-run
      const runEndTime = performance.now();
      const runDurationMs = runEndTime - runStartTime;
      logger.section('Final Summary (Dry Run)');
      logger.info(`Session ID: ${sessionId}`);
      logger.info(`Total users that would be processed: ${wouldProcess.length}`);
      logger.info(`Total users available: ${filteredRows.length}`);
      logger.info(`Run Duration: ${formatRunDuration(runDurationMs)}`);
      logger.success('Dry run completed successfully');
      return;
    }
    
    logger.section('Browser Initialization');
    try {
      const browserResult = await initializeBrowser();
      browser = browserResult.browser;
      
      // Verify login with a temporary page (will be closed)
      const tempPage = await browser.newPage();
      await tempPage.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });
      await humanDelay(2000, 3000);
      
      const loginInput = await tempPage.$('input[name="username"]');
      if (loginInput) {
        await tempPage.close();
        throw new Error('Not logged in. Please run loginSeeder.js first to establish session.');
      }
      
      // Close the temporary verification page
      await tempPage.close();
      logger.success('Browser initialized and session verified');
      
      // --- STEP 5: Iterate Through Users ---
      logger.section('Drafting Messages');
      
      let draftedCount = 0;
      let sentCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      let sendFailedCount = 0;
      
      // Determine which counter to use for limit checking
      const shouldCheckSentCount = config.sendMessage;
      
      for (let i = 0; i < filteredRows.length; i++) {
        // Check limit based on mode
        if (shouldCheckSentCount && sentCount >= config.maxDraft) {
          break;
        } else if (!shouldCheckSentCount && draftedCount >= config.maxDraft) {
          break;
        }
        const row = filteredRows[i];
        logger.info(`Processing user ${i + 1}/${filteredRows.length}: ${row.username}`);
        
        // Create a new tab for this user
        logger.info(`Creating new tab for ${row.username}...`);
        const userPage = await browser.newPage();
        logger.success(`New tab created for ${row.username} (tab ${i + 1})`);
        
        // Track whether drafting succeeded for this user
        let draftingSucceeded = false;
        let messageSent = false; // Track if message was sent (only relevant if SEND_MESSAGE=true)
        
        // Small delay before starting work on the new tab
        await humanDelay(500, 1000);
        
        try {
          const result = await processUser(userPage, row, config);
          
          if (result.skipped) {
            // Update sheet with "Skipped" status
            // Do NOT update Date Sent or Message - preserve existing values
            try {
              await updateDraftData(result.rowIndex, sessionId, '', '', 'Skipped');
              logger.success(`Updated sheet for ${result.username} (row ${result.rowIndex}) - Status: Skipped, Session ID: ${sessionId}`);
            } catch (updateError) {
              logger.error(`Failed to update sheet for ${result.username}: ${updateError.message}`);
            }
            skippedCount++;
            // Drafting did not succeed - tab will be closed immediately
            logger.info(`Skipping ${row.username}: existing conversation detected - closing tab immediately`);
            draftingSucceeded = false;
            // Close tab immediately for skipped conversations
            try {
              await userPage.close();
              logger.success(`Tab closed immediately for ${row.username} (skipped due to existing conversation)`);
            } catch (closeError) {
              logger.error(`Error closing tab for ${row.username}: ${closeError.message}`);
            }
            // Continue to next user (skip the tab closing logic at the end)
            await humanDelay(2000, 4000);
            continue;
          } else if (result.success) {
            // Determine status based on SEND_MESSAGE and send result
            let status = 'Drafted';
            if (config.sendMessage) {
              if (result.sent) {
                status = 'Sent';
                sentCount++;
              } else {
                status = 'Send Failed';
                sendFailedCount++;
              }
            } else {
              draftedCount++;
            }
            
            // Update Google Sheet with appropriate status
            try {
              const timestamp = new Date().toISOString();
              
              // For "Send Failed" status, preserve existing Date Sent and Message
              if (status === 'Send Failed') {
                await updateDraftData(result.rowIndex, sessionId, '', '', status);
              } else {
                // For "Drafted" or "Sent", update Date Sent and Message
                await updateDraftData(result.rowIndex, sessionId, timestamp, result.message, status);
              }
              
              logger.success(`Updated sheet for ${result.username} (row ${result.rowIndex}) - Status: ${status}, Session ID: ${sessionId}`);
              
              // Track success for tab management
              if (config.sendMessage) {
                messageSent = result.sent || false; // Store send status
                if (result.sent) {
                  // Message sent successfully - tab will be closed
                  draftingSucceeded = true; // Mark as succeeded, but tab will close
                  logger.success(`Message sent successfully for ${row.username} - tab will be closed`);
                } else {
                  // Send failed - keep tab open for debugging
                  draftingSucceeded = false; // Mark as failed so tab stays open
                  logger.error(`Message send failed for ${row.username} - tab will remain open for debugging`);
                }
              } else {
                // Draft only mode - tab will remain open
                draftingSucceeded = true;
                logger.success(`Drafting succeeded for ${row.username} - tab will remain open`);
              }
              
            } catch (updateError) {
              logger.error(`Failed to update sheet for ${result.username}: ${updateError.message}`);
              errorCount++;
              // Sheet update failed, but drafting succeeded
              draftingSucceeded = true;
            }
          } else {
            // Update sheet with "Failed" status
            // Do NOT update Date Sent or Message for failed rows
            try {
              const errorMessage = result.error || 'Unknown error';
              await updateDraftData(result.rowIndex, sessionId, '', '', 'Failed');
              logger.success(`Updated sheet for ${result.username} (row ${result.rowIndex}) - Status: Failed, Session ID: ${sessionId}`);
              logger.error(`Failure reason: ${errorMessage}`);
            } catch (updateError) {
              logger.error(`Failed to update sheet for ${result.username}: ${updateError.message}`);
            }
            errorCount++;
            // Drafting did not succeed - tab will be closed
            logger.info(`Drafting failed for ${result.username}: ${result.error || 'Unknown error'}`);
            draftingSucceeded = false;
          }
          
        } catch (userError) {
          // Update sheet with "Failed" status for unexpected errors
          // Do NOT update Date Sent or Message for failed rows
          try {
            const errorMessage = userError.message || 'Unexpected error';
            await updateDraftData(row.rowIndex, sessionId, '', '', 'Failed');
            logger.success(`Updated sheet for ${row.username} (row ${row.rowIndex}) - Status: Failed, Session ID: ${sessionId}`);
            logger.error(`Failure reason: ${errorMessage}`);
          } catch (updateError) {
            logger.error(`Failed to update sheet for ${row.username}: ${updateError.message}`);
          }
          errorCount++;
          logger.error(`Unexpected error processing ${row.username}: ${userError.message}`);
          // Drafting did not succeed - tab will be closed
          draftingSucceeded = false;
        }
        
        // Conditionally close tab based on SEND_MESSAGE mode and success
        // Note: Skipped conversations already had their tabs closed above
        if (config.sendMessage) {
          // SEND_MESSAGE=true mode
          if (draftingSucceeded && messageSent) {
            // Message sent successfully - close tab
            logger.info(`Closing tab for ${row.username} - message sent successfully`);
            try {
              await userPage.close();
              logger.success(`Tab closed for ${row.username}`);
            } catch (closeError) {
              logger.error(`Error closing tab for ${row.username}: ${closeError.message}`);
            }
          } else if (!draftingSucceeded || !messageSent) {
            // Send failed - keep tab open for debugging
            logger.info(`Keeping tab open for ${row.username} - send failed, tab available for debugging`);
          }
        } else {
          // SEND_MESSAGE=false mode (draft only)
          if (draftingSucceeded) {
            logger.info(`Keeping tab open for ${row.username} - message successfully drafted`);
          } else {
            logger.info(`Closing tab for ${row.username} - drafting failed`);
            try {
              await userPage.close();
              logger.success(`Tab closed for ${row.username}`);
            } catch (closeError) {
              logger.error(`Error closing tab for ${row.username}: ${closeError.message}`);
            }
          }
        }
        
        // Human-like delay before creating next tab
        await humanDelay(2000, 4000);
        
        // Check if we've reached the draft limit
        if (config.sendMessage) {
          // In send mode, count sent messages
          if (sentCount >= config.maxDraft) {
            logger.warn(`Reached MAX_DRAFT limit (${config.maxDraft}). Stopping.`);
            break;
          }
        } else {
          // In draft mode, count drafted messages
          if (draftedCount >= config.maxDraft) {
            logger.warn(`Reached MAX_DRAFT limit (${config.maxDraft}). Stopping.`);
            logger.info(`All ${draftedCount} successfully drafted tabs remain open for manual sending.`);
            break;
          }
        }
      }
      
      // --- STEP 6: Final Summary ---
      // Capture end time before generating summary
      const runEndTime = performance.now();
      const runDurationMs = runEndTime - runStartTime;
      
      logger.section('Final Summary');
      logger.info(`Session ID: ${sessionId}`);
      logger.info(`Processed: ${filteredRows.length}`);
      
      if (config.sendMessage) {
        logger.success(`Sent: ${sentCount}`);
        logger.error(`Send Failed: ${sendFailedCount}`);
        logger.warn(`Skipped: ${skippedCount}`);
        logger.error(`Errors: ${errorCount}`);
        if (sendFailedCount > 0) {
          logger.info(`Browser contains ${sendFailedCount} open tabs with failed sends for debugging.`);
        }
      } else {
        logger.success(`Drafted: ${draftedCount}`);
        logger.warn(`Skipped: ${skippedCount}`);
        logger.error(`Errors: ${errorCount}`);
        logger.info(`Browser contains ${draftedCount} open tabs with successfully drafted messages.`);
        logger.info(`Each open tab contains a drafted message ready for manual sending.`);
      }
      logger.info(`Run Duration: ${formatRunDuration(runDurationMs)}`);
      logger.info(`All processed rows have been updated with Session ID: ${sessionId}`);
      
    } catch (browserError) {
      // Capture end time even on browser errors
      const runEndTime = performance.now();
      const runDurationMs = runEndTime - runStartTime;
      
      logger.error(`Browser error: ${browserError.message}`);
      logger.section('Error Summary');
      logger.info(`Session ID: ${sessionId}`);
      logger.info(`Run Duration: ${formatRunDuration(runDurationMs)}`);
      throw browserError;
    } finally {
      // --- STEP 7: Keep Browser Open for Inspection ---
      if (browser) {
        logger.section('Script Completed');
        logger.info('Browser will remain open for inspection.');
        logger.info('Close the browser manually when finished.');
        // Browser stays open - do not close it
      }
    }
    
  } catch (fatalError) {
    // Capture end time even on fatal errors
    const runEndTime = performance.now();
    const runDurationMs = runEndTime - runStartTime;
    
    logger.error(`Fatal error: ${fatalError.message}`);
    logger.section('Fatal Error Summary');
    logger.info(`Session ID: ${sessionId}`);
    logger.info(`Run Duration: ${formatRunDuration(runDurationMs)}`);
    
    if (browser) {
      logger.section('Fatal Error - Browser Remains Open');
      logger.info('Browser will remain open for inspection.');
      logger.info('Close the browser manually when finished.');
      // Browser stays open for inspection even on fatal errors
    }
    // Don't exit immediately - let user inspect before closing
    logger.warn('Press Ctrl+C to exit and close the browser.');
  }
}

// Run the orchestrator
run().catch(error => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});

