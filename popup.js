// popup.js (ES Module version)

// Import pdf.js as an ES Module
import * as pdfjsLib from './libs/pdf.mjs'; 

// Configure pdf.js worker script
pdfjsLib.GlobalWorkerOptions.workerSrc = './libs/pdf.worker.mjs';


// Save user settings (Auto-Apply & Minimum Score)
document.getElementById("saveSettings").addEventListener("click", () => {
  const autoApply = document.getElementById("autoApply").checked;
  const minScore = document.getElementById("minScore").value;
  
  chrome.storage.local.set({ autoApply, minScore }, () => {
    alert("✅ Settings saved successfully!");
  });
});

// Handle PDF Resume Upload
document.getElementById("resumeUpload").addEventListener("change", function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();

  reader.onload = function () {
    const typedarray = new Uint8Array(this.result);

    // Extract text using pdf.js
    pdfjsLib.getDocument(typedarray).promise.then(pdf => {
      let pagesPromises = [];

      // Extract text from each page
      for (let i = 1; i <= pdf.numPages; i++) {
        pagesPromises.push(
          pdf.getPage(i).then(page =>
            page.getTextContent().then(textContent =>
              textContent.items.map(item => item.str).join(" ")
            )
          )
        );
      }

      // Combine text from all pages
      Promise.all(pagesPromises).then(pagesText => {
        const fullText = pagesText.join(" ");

        // Store the extracted resume text in Chrome's local storage
        chrome.storage.local.set({ resumeText: fullText }, () => {
          console.log("✅ Resume text stored successfully");
          alert("✅ Resume uploaded and processed successfully!");
        });
      });
    }).catch(error => {
      console.error("❌ Error processing PDF:", error);
      alert("❌ Error processing PDF. Please try again.");
    });
  };

  reader.readAsArrayBuffer(file);
});
