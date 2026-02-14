// messageDrafter.js
require('dotenv').config();
const { humanDelay, ts } = require('./utils');
const logger = require('./logger');

/**
 * Confirms that a message was successfully sent by detecting a new outgoing message bubble.
 * Uses multiple detection strategies for reliability.
 * @param {object} page - Playwright Page object (DM thread)
 * @returns {Promise<boolean>} True if message bubble appears, false otherwise
 */
async function confirmMessageSent(page) {
  logger.info('Confirming message was sent...');
  
  try {
    // Wait a bit for the message to appear
    await humanDelay(1500, 2500, 'waiting for message bubble');
    
    // Strategy 1: Count message rows before and after
    // Instagram messages are typically in div[role="row"] elements
    const messageRowsBefore = await page.$$('div[role="row"]').then(rows => rows.length);
    
    // Wait a bit more for the new message to render
    await humanDelay(1000, 1500);
    
    const messageRowsAfter = await page.$$('div[role="row"]').then(rows => rows.length);
    
    if (messageRowsAfter > messageRowsBefore) {
      logger.success(`Message bubble detected - message count increased from ${messageRowsBefore} to ${messageRowsAfter}`);
      return true;
    }
    
    // Strategy 2: Check if input field is cleared (message was sent)
    const inputSelectors = [
      'p[contenteditable="true"]',
      'div[contenteditable="true"]',
      'textarea',
    ];
    
    for (const selector of inputSelectors) {
      const input = await page.$(selector);
      if (input) {
        const inputText = await page.evaluate(el => el.innerText || el.textContent || '', input);
        if (!inputText || inputText.trim() === '') {
          // Input is cleared, which suggests message was sent
          logger.success('Input field cleared - message likely sent');
          // But verify with message count as well
          if (messageRowsAfter >= messageRowsBefore) {
            return true;
          }
        }
      }
    }
    
    // Strategy 3: Look for the most recent message bubble
    // Check if the last message row contains text (indicating a new message appeared)
    const allMessageRows = await page.$$('div[role="row"]');
    if (allMessageRows.length > 0) {
      const lastMessage = allMessageRows[allMessageRows.length - 1];
      const messageText = await lastMessage.textContent();
      
      // If the last message has substantial text, it's likely our sent message
      if (messageText && messageText.trim().length > 5) {
        logger.success('Message bubble detected via last message text content');
        return true;
      }
    }
    
    // Strategy 4: Check for sent indicators or status changes
    // Instagram sometimes shows visual indicators
    const sentIndicators = [
      'span:has-text("Sent")',
      'div[aria-label*="Sent"]',
      'div[aria-label*="sent"]',
    ];
    
    for (const selector of sentIndicators) {
      try {
        const indicator = await page.$(selector);
        if (indicator) {
          logger.success('Sent indicator detected');
          return true;
        }
      } catch (e) {
        // Selector might not be supported, continue
      }
    }
    
    // Strategy 5: Check if the input field lost focus (message was sent)
    // This is a weaker signal but can help
    const activeElement = await page.evaluate(() => {
      return document.activeElement?.tagName || '';
    });
    
    // If active element is not the input, message might have been sent
    if (activeElement && !['P', 'DIV', 'TEXTAREA'].includes(activeElement)) {
      logger.info('Input field lost focus - possible message sent');
      // Combine with message count check
      if (messageRowsAfter >= messageRowsBefore) {
        return true;
      }
    }
    
    logger.warn(`Could not confirm message was sent - message count: ${messageRowsBefore} -> ${messageRowsAfter}`);
    return false;
    
  } catch (error) {
    logger.error(`Error confirming message sent: ${error.message}`);
    return false;
  }
}

/**
 * Sends a drafted message by pressing ENTER key.
 * @param {object} page - Playwright Page object (DM thread with message drafted)
 * @param {object} inputElement - The input element where message is typed
 * @returns {Promise<boolean>} True if ENTER was pressed successfully
 */
async function sendMessage(page, inputElement) {
  logger.info('Sending message by pressing ENTER...');
  
  try {
    // Ensure input is focused
    await inputElement.focus();
    await humanDelay(200, 400, 'before pressing ENTER');
    
    // Press ENTER to send
    await page.keyboard.press('Enter');
    logger.success('ENTER key pressed');
    
    return true;
  } catch (error) {
    logger.error(`Error sending message: ${error.message}`);
    return false;
  }
}

/**
 * Drafts a message in an Instagram DM, optionally sending it.
 * Message text is used verbatim from the sheet (no templating or personalization).
 * @param {object} dmPage - Playwright Page object (DM thread already open)
 * @param {object} options
 * @param {string} options.messageText - Message text to draft (verbatim from sheet)
 * @param {boolean} [options.sendMessage] - Whether to send the message after drafting (default: false)
 * @returns {Promise<{ success: boolean, sent?: boolean, message?: string, typedText?: string }>}
 */
async function draftMessage(dmPage, options = {}) {
  logger.info('Starting message drafting process...');

  try {
    // Get message text from options (required)
    const messageText = options.messageText;
    
    if (!messageText || typeof messageText !== 'string' || messageText.trim() === '') {
      logger.error('Message text is required and must be a non-empty string');
      return { success: false, error: 'Missing or empty message text' };
    }

    // Use message text verbatim (no modifications)
    const message = messageText;

    logger.info(`Drafting message (verbatim from sheet): "${message}"`);

    // --- STEP 3: Locate Instagram DM input field ---
    const selectors = [
      'p[contenteditable="true"]',
      'div[contenteditable="true"]',
      'p[dir="auto"][contenteditable]',
      'textarea',
      'div[role="textbox"]',
    ];

    let input = null;
    for (const sel of selectors) {
      input = await dmPage.$(sel);
      if (input) {
        logger.success(`Found input field: ${sel}`);
        break;
      }
    }

    if (!input) {
      logger.error('No DM input field found');
      return { success: false, error: 'No DM input field found', message };
    }

    // --- STEP 4: Focus & clear existing text ---
    await humanDelay(250, 500, 'before focusing DM input');
    await input.click({ delay: 100 });
    await humanDelay(250, 500, 'after focusing DM input');
    await dmPage.keyboard.down('Control');
    await dmPage.keyboard.press('A');
    await dmPage.keyboard.up('Control');
    await dmPage.keyboard.press('Backspace');
    logger.info('Cleared existing text');

    // --- STEP 5: Type message (simulate human typing) ---
    const firstTen = message.slice(0, 10);
    const remainder = message.slice(10);

    for (const ch of firstTen.split('')) {
      await humanDelay(40, 100, 'between keystrokes');
      await dmPage.keyboard.type(ch);
    }
    if (remainder.length > 0) {
      await humanDelay(250, 500, 'before bulk insert');
      await dmPage.keyboard.insertText(remainder);
    }

    // Dispatch input/change so IG recognizes text
    await dmPage.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, input);

    // --- STEP 6: Verify message appears ---
    await humanDelay(500, 1000, 'after text entry');
    const typedText = await dmPage.evaluate(el => el.innerText || el.textContent, input);

    if (typedText && typedText.trim() === message.trim()) {
      logger.success('Message populated successfully');
    } else {
      logger.error('Verification failed');
      logger.info(`Expected: ${message}`);
      logger.info(`Got: ${typedText}`);
      return { success: false, error: 'Message verification failed', message, typedText };
    }
    
    // --- STEP 7: Send message if SEND_MESSAGE is enabled ---
    const shouldSend = options.sendMessage ?? parseBoolean(process.env.SEND_MESSAGE, false);
    let sent = false;
    
    if (shouldSend) {
      logger.info('SEND_MESSAGE is enabled - attempting to send message...');
      
      // Send the message
      const sendSuccess = await sendMessage(dmPage, input);
      
      if (sendSuccess) {
        // Wait a bit for the message to process
        await humanDelay(1000, 2000, 'after pressing ENTER');
        
        // Confirm message was sent
        const confirmed = await confirmMessageSent(dmPage);
        
        if (confirmed) {
          logger.success('Message sent and confirmed successfully');
          sent = true;
        } else {
          // Retry once
          logger.warn('Message send confirmation failed - retrying once...');
          await humanDelay(500, 1000);
          
          const retrySuccess = await sendMessage(dmPage, input);
          if (retrySuccess) {
            await humanDelay(1000, 2000, 'after retry ENTER');
            const retryConfirmed = await confirmMessageSent(dmPage);
            
            if (retryConfirmed) {
              logger.success('Message sent and confirmed after retry');
              sent = true;
            } else {
              logger.error('Message send failed after retry - bubble not detected');
              sent = false;
            }
          } else {
            logger.error('Failed to retry sending message');
            sent = false;
          }
        }
      } else {
        logger.error('Failed to press ENTER to send message');
        sent = false;
      }
    } else {
      logger.info('SEND_MESSAGE is disabled - message drafted but not sent');
    }
    
    return { 
      success: true, 
      sent: shouldSend ? sent : undefined, // Only include sent if SEND_MESSAGE was enabled
      message, 
      typedText 
    };
  } catch (err) {
    logger.error(`Drafting error: ${err.message}`);
    return { success: false };
  }
}

/**
 * Helper function to parse boolean from environment variable
 * @param {string} value - Environment variable value
 * @param {boolean} defaultValue - Default value
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue = false) {
  if (!value || typeof value !== 'string') {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }
  return defaultValue;
}

module.exports = { 
  draftMessage,
  sendMessage,
  confirmMessageSent,
};
