// content.js

// Function to extract job details from LinkedIn
function getJobDetails() {
  return {
    jobTitle: document.querySelector('.topcard__title')?.innerText || "Unknown Title",
    company: document.querySelector('.topcard__org-name-link')?.innerText || "Unknown Company",
    location: document.querySelector('.topcard__flavor')?.innerText || "Unknown Location",
    jobDesc: document.querySelector('.show-more-less-html')?.innerText || "No Description",
    jobLink: window.location.href
  };
}

// Attempt auto-apply when conditions are met
function attemptAutoApply(matchScore, minScore, autoApplyEnabled) {
  if (autoApplyEnabled && matchScore >= minScore) {
    console.log(`✅ Match score meets criteria: ${matchScore} >= ${minScore}`);

    const observer = new MutationObserver((mutations, obs) => {
      const applyButton = document.querySelector('button[aria-label*="Easy Apply"], button.jobs-apply-button');
      if (applyButton) {
        applyButton.click();
        console.log("🎯 AI Auto-Apply Triggered!");
        obs.disconnect();
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback timeout in case MutationObserver misses it
    setTimeout(() => observer.disconnect(), 10000);

  } else {
    console.log(`❌ Auto-Apply skipped. Match Score: ${matchScore}, Required: ${minScore}`);
  }
}

// Main function triggered when the DOM content is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  const jobDetails = getJobDetails();
  chrome.runtime.sendMessage({ action: "job_details", data: jobDetails });

  chrome.storage.local.get(["matchScore", "minScore", "autoApply"], (result) => {
    const matchScore = parseInt(result.matchScore) || 0;
    const minScore = parseInt(result.minScore) || 75;
    const autoApplyEnabled = result.autoApply;

    // Slight delay to ensure LinkedIn DOM fully loads the button
    setTimeout(() => attemptAutoApply(matchScore, minScore, autoApplyEnabled), 3000);
  });
});
