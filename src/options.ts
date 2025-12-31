document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key') as HTMLInputElement;
  const saveButton = document.getElementById('save-button');

  const status = document.getElementById('status');

  // Load the saved API key when the options page is opened
  chrome.storage.local.get(['apiKey'], (data) => {
    if (data.apiKey) {
      apiKeyInput.value = data.apiKey;
    }
  });

  // Save the API key when the save button is clicked
  if (saveButton && status) {
    saveButton.addEventListener('click', () => {
      const apiKey = apiKeyInput.value.trim();
      chrome.storage.local.set({ apiKey: apiKey }, () => {
        status.textContent = 'Settings saved!';
        status.className = 'status-shown';
        setTimeout(() => {
          status.className = 'status-hidden';
        }, 3000);
      });
    });
  }
});
