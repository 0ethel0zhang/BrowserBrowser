document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const apiEndpointInput = document.getElementById('api-endpoint') as HTMLInputElement;
  const saveButton = document.getElementById('save-button');

  // Load the saved API key and endpoint when the options page is opened
  chrome.storage.local.get(['apiKey', 'apiEndpoint'], (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
    if (data.apiEndpoint) {
      apiEndpointInput.value = data.apiEndpoint;
    }
  });

  // Save the API key and endpoint when the save button is clicked
  if (saveButton) {
    saveButton.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      const apiEndpoint = apiEndpointInput.value.trim();
      if (apiKey && apiEndpoint) {
        chrome.storage.local.set({ apiKey: apiKey, apiEndpoint: apiEndpoint }, () => {
          console.log('API key and endpoint saved.');
          // You might want to add a status message to the UI
        });
      }
    });
  }
});
