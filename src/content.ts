// This script will be injected into web pages.
console.log("Content script loaded.");

function performClick(selector: string) {
  const element = document.querySelector(selector) as HTMLElement;
  if (element) {
    element.click();
  } else {
    console.error("Could not find element to click:", selector);
  }
}

function performType(selector: string, text: string) {
  const element = document.querySelector(selector) as HTMLInputElement;
  if (element) {
    if (element.type === 'password') {
      console.warn("Attempted to type into a password field. Action blocked for security.");
      // In a real implementation, we would send a message back to the UI
      // to request user consent before proceeding.
      return;
    }
    element.focus();
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    console.error("Could not find element to type in:", selector);
  }
}

function performNavigate(url: string) {
  window.location.href = url;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "getDOM") {
    console.log("Received getDOM request.");
    sendResponse({ content: document.documentElement.outerHTML });
  } else if (request.type === "action") {
    console.log("Received action in content script:", request.action);
    const { action, selector, text, url } = request.action;

    switch (action) {
      case 'click':
        performClick(selector);
        break;
      case 'type':
        performType(selector, text);
        break;
      case 'navigate':
        performNavigate(url);
        break;
      default:
        console.error("Unknown action:", request.action);
    }
  }
  // Keep the message channel open for the asynchronous response.
  return true;
});
