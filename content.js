// content.js - Optimized LinkedIn Job Scraper

// ========================
// Configuration
// ========================
const CONFIG = {
  SELECTORS: {
    JOB_TITLE: [
      '.jobs-unified-top-card__job-title',
      '.job-details-jobs-unified-top-card__job-title',
      '[data-test-job-title]'
    ],
    COMPANY: [
      '.jobs-unified-top-card__company-name',
      '.job-details-jobs-unified-top-card__company-name',
      '[data-test-hiring-company-name]'
    ],
    LOCATION: [
      '.jobs-unified-top-card__bullet',
      '.job-details-jobs-unified-top-card__location',
      '[data-test-job-location]'
    ],
    DESCRIPTION: [
      '.jobs-description__content',
      '.job-details-jobs-description__content',
      '[data-test-job-description-text]'
    ],
    BUTTONS: {
      SEE_MORE: 'button.jobs-description__see-more-button, button.job-details-how-you-match__see-more',
      APPLY: 'button.jobs-apply-button, button.job-details-apply-button',
      SUBMIT: 'button[aria-label="Submit application"], button[data-test-modal-close-btn]'
    }
  },
  TIMEOUTS: {
    PAGE_LOAD: 3000,
    ELEMENT_WAIT: 2000,
    CLICK_DELAY: 1500
  },
  MAX_RETRIES: 3
};

// ========================
// Core Utilities
// ========================
const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const safeQuerySelector = (selector) => document.querySelector(selector) || null;

const getElementText = (element) => 
  element?.textContent?.trim()?.replace(/\s+/g, ' ') || '';

const findFirstValidElement = (selectors) => {
  if (typeof selectors === 'string') {
    return safeQuerySelector(selectors);
  }
  
  for (const selector of selectors) {
    const element = safeQuerySelector(selector);
    if (element) return element;
  }
  return null;
};

// ========================
// DOM Interaction Helpers
// ========================
const expandJobDescription = async () => {
  const seeMoreButton = findFirstValidElement(CONFIG.SELECTORS.BUTTONS.SEE_MORE);
  if (seeMoreButton && seeMoreButton.offsetParent !== null) {
    seeMoreButton.click();
    await waitFor(CONFIG.TIMEOUTS.CLICK_DELAY);
  }
};

const clickWithRetry = async (selector, retries = CONFIG.MAX_RETRIES) => {
  for (let i = 0; i < retries; i++) {
    const element = findFirstValidElement(selector);
    if (element && element.offsetParent !== null) {
      element.click();
      await waitFor(CONFIG.TIMEOUTS.CLICK_DELAY);
      return true;
    }
    await waitFor(500);
  }
  return false;
};

// ========================
// Data Extraction
// ========================
const extractJobDetails = async () => {
  await expandJobDescription();
  
  // Wait for content to load
  await waitFor(CONFIG.TIMEOUTS.ELEMENT_WAIT);

  const titleElement = findFirstValidElement(CONFIG.SELECTORS.JOB_TITLE);
  const companyElement = findFirstValidElement(CONFIG.SELECTORS.COMPANY);
  const locationElement = findFirstValidElement(CONFIG.SELECTORS.LOCATION);
  const descriptionElement = findFirstValidElement(CONFIG.SELECTORS.DESCRIPTION);

  return {
    title: getElementText(titleElement),
    company: getElementText(companyElement),
    location: getElementText(locationElement),
    description: getElementText(descriptionElement),
    url: window.location.href.split('?')[0],
    timestamp: new Date().toISOString(),
    fullPageText: document.body.innerText.substring(0, 10000) // Safety limit
  };
};

// ========================
// Application Automation
// ========================
const handleJobApplication = async () => {
  try {
    // Initial apply button click
    const applied = await clickWithRetry(CONFIG.SELECTORS.BUTTONS.APPLY);
    if (!applied) return { error: 'Apply button not found or clickable' };

    // Handle multi-step application flow
    await waitFor(CONFIG.TIMEOUTS.PAGE_LOAD);
    
    // Final submission
    const submitted = await clickWithRetry(CONFIG.SELECTORS.BUTTONS.SUBMIT);
    return submitted 
      ? { success: true } 
      : { error: 'Failed to find submit button' };
  } catch (error) {
    console.error('Application error:', error);
    return { error: error.message };
  }
};

// ========================
// Message Handling
// ========================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleRequest = async () => {
    try {
      switch (request.type) {
        case 'SCRAPE_JOB_DETAILS':
          return await extractJobDetails();
          
        case 'AUTO_APPLY':
          return await handleJobApplication();
          
        default:
          return { error: 'Unknown action requested' };
      }
    } catch (error) {
      console.error('Request handling failed:', error);
      return { error: error.message };
    }
  };

  // Execute and respond
  handleRequest().then(sendResponse);
  return true; // Required for async response
});

// ========================
// DOM Observation
// ========================
const setupMutationObserver = () => {
  const observer = new MutationObserver(async () => {
    if (window.location.href.includes('/jobs/view/')) {
      const details = await extractJobDetails();
      chrome.runtime.sendMessage({
        type: 'JOB_CONTENT_UPDATED',
        details
      });
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: false,
    characterData: false
  });

  return observer;
};

// ========================
// Initialization
// ========================
const initializeContentScript = () => {
  // Set up DOM observer
  setupMutationObserver();
  
  // Notify background script we're ready
  chrome.runtime.sendMessage({ type: 'CONTENT_SCRIPT_READY' });
  
  console.debug('LinkedIn Job Scraper initialized');
};

// Start the content script
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeContentScript);
} else {
  initializeContentScript();
}
