document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const saveButton = document.getElementById('save-button');

  // Load the saved API key when the options page is opened
  chrome.storage.local.get(['apiKey'], (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
  });

  // Save the API key when the save button is clicked
  if (saveButton) {
    saveButton.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      if (apiKey) {
        chrome.storage.local.set({ apiKey: apiKey }, () => {
          console.log('API key saved.');
          // You might want to add a status message to the UI
        });
      }
    });
  }
});
