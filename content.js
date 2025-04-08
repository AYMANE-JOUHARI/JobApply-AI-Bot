// content.js - Complete Revised Version

// ========================
// PDF.js Initialization
// ========================
let pdfjsLib;
let pdfInitialized = false;

const initializePDF = async () => {
  if (pdfInitialized) return;
  
  try {
    const pdfjsUrl = chrome.runtime.getURL('scripts/pdf.mjs');
    const workerUrl = chrome.runtime.getURL('scripts/pdf.worker.mjs');
    
    // Dynamic ES module import with fallback
    const module = await import(pdfjsUrl);
    pdfjsLib = module;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    pdfInitialized = true;
    console.debug('PDF.js initialized successfully');
  } catch (error) {
    console.error('PDF.js initialization failed:', error);
    throw new Error('PDF processing unavailable');
  }
};

// ========================
// DOM Selectors & Utilities
// ========================
const SELECTORS = {
  TITLE: [
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
    SEE_MORE: [
      'button.jobs-description__see-more-button',
      'button.job-details-how-you-match__see-more'
    ],
    APPLY: [
      'button.jobs-apply-button',
      'button.job-details-apply-button'
    ],
    SUBMIT: [
      'button[aria-label="Submit application"]',
      'button[data-test-modal-close-btn]'
    ]
  }
};

const findElement = (selectors) => {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) return element;
  }
  return null;
};

const getSafeText = (element) => 
  element?.textContent?.trim()?.replace(/\s+/g, ' ') || '';

// ========================
// Core Functionality
// ========================
const expandDescription = () => {
  const seeMoreButton = findElement(SELECTORS.BUTTONS.SEE_MORE);
  if (seeMoreButton) {
    seeMoreButton.click();
    return new Promise(resolve => setTimeout(resolve, 500));
  }
  return Promise.resolve();
};

const scrapeJobDetails = async () => {
  try {
    await expandDescription();
    
    return {
      title: getSafeText(findElement(SELECTORS.TITLE)),
      company: getSafeText(findElement(SELECTORS.COMPANY)),
      location: getSafeText(findElement(SELECTORS.LOCATION)),
      description: [
        findElement(SELECTORS.DESCRIPTION),
        document.querySelector('.jobs-description-details__list'),
        document.querySelector('.job-details-how-you-match__skills-list')
      ].map(el => getSafeText(el)).join('\n'),
      url: window.location.href.split('?')[0],
      postedDate: getSafeText(document.querySelector(
        '.jobs-unified-top-card__posted-date, ' +
        '.job-details-jobs-unified-top-card__posted-date'
      ))
    };
  } catch (error) {
    console.error('Scraping error:', error);
    return { error: 'Failed to extract job details' };
  }
};

const handleApplication = async () => {
  try {
    const applyButton = findElement(SELECTORS.BUTTONS.APPLY);
    if (!applyButton) return { error: 'Apply button not found' };

    applyButton.click();
    
    // Handle multi-step application flow
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const submitButton = findElement(SELECTORS.BUTTONS.SUBMIT);
    if (submitButton) {
      submitButton.click();
      return { success: true };
    }
    return { error: 'Submission failed' };
  } catch (error) {
    console.error('Application error:', error);
    return { error: 'Application process failed' };
  }
};

// ========================
// Core Functionality (with PDF init checks)
// ========================
const processResumePDF = async (file) => {
  try {
    if (!pdfInitialized) await initializePDF();
    
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async ({ target }) => {
        try {
          const pdf = await pdfjsLib.getDocument({ 
            data: new Uint8Array(target.result) 
          }).promise;
          
          let text = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ');
          }
          resolve(text);
        } catch (error) {
          reject(error);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  } catch (error) {
    console.error('PDF processing failed:', error);
    throw error;
  }
};

// ========================
// Message Handling (with init safeguard)
// ========================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handleRequest = async () => {
    try {
      switch (request.action) {
        case 'processResume':
          return await processResumePDF(request.file);
          
        case 'getJobDetails':
          return await scrapeJobDetails();
          
        case 'applyToJob':
          return await handleApplication();
          
        default:
          return { error: 'Unknown action' };
      }
    } catch (error) {
      console.error('Request failed:', error);
      return { error: error.message };
    }
  };

  handleRequest().then(sendResponse);
  return true;
});


// ========================
// DOM Observation
// ========================
const observer = new MutationObserver(() => {
  scrapeJobDetails().then(details => {
    chrome.runtime.sendMessage({
      action: 'jobContentUpdated',
      details
    });
  });
});

observer.observe(document.body, {
  subtree: true,
  childList: true,
  attributes: false
});

console.log('Content script initialized');
