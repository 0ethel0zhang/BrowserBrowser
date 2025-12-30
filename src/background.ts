// This is the background service worker.
console.log("Background script loaded.");

let currentGoal = "";
let isRunning = false;

// Function to call the LLM API
async function callLLM(apiKey: string, apiEndpoint: string, goal: string, pageContent: string): Promise<any> {
  console.log("Calling LLM with goal:", goal);

  const requestBody = {
    prompt: `
      You are an intelligent web agent.
      Your goal is: "${goal}"
      The current state of the page is:
      ${pageContent}

      Based on the current page content and the goal, what is the next action to take?
      Respond with a JSON object with one of the following actions:
      - { "action": "type", "selector": "css-selector", "text": "text-to-type" }
      - { "action": "click", "selector": "css-selector" }
      - { "action": "navigate", "url": "url-to-navigate-to" }
      - { "action": "goal_complete" }
    `,
  };

  try {
    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();
    return data;

  } catch (error) {
    console.error("Error calling LLM API:", error);
    return { action: "goal_complete" };
  }
}

function controlLoop(apiKey: string, apiEndpoint: string) {
  if (!isRunning) {
    return;
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && tabs[0].id) {
      const tabId = tabs[0].id;
      // Handshake with content script
      chrome.tabs.sendMessage(tabId, { type: "ping" }, (response) => {
        if (chrome.runtime.lastError || !response || response.type !== "pong") {
          console.error("Content script not ready. Retrying in 1 second.");
          setTimeout(() => controlLoop(apiKey, apiEndpoint), 1000);
          return;
        }

        // Content script is ready, proceed with getDOM
        chrome.tabs.sendMessage(tabId, { type: "getDOM" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            isRunning = false;
            return;
          }
          const pageContent = response.content;

          callLLM(apiKey, apiEndpoint, currentGoal, pageContent).then((action) => {
            console.log("Received action from LLM:", action);

            if (action.action === "goal_complete") {
              console.log("Goal is complete.");
              isRunning = false;
              return;
            }

            chrome.tabs.sendMessage(tabId, { type: "action", action: action }, () => {
              setTimeout(() => controlLoop(apiKey, apiEndpoint), 1000);
            });
          });
        });
      });
    } else {
      console.log("No active tab found.");
      isRunning = false;
    }
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in background script:", request);
  if (request.type === "goal") {
    if (isRunning) {
      console.log("Already running, ignoring new goal.");
      return true;
    }
    console.log("Received new goal:", request.goal);
    currentGoal = request.goal;

    chrome.storage.local.get(['apiKey', 'apiEndpoint'], (data) => {
      if (data.apiKey && data.apiEndpoint) {
        isRunning = true;
        controlLoop(data.apiKey, data.apiEndpoint);
      } else {
        chrome.runtime.sendMessage({ type: "apiKeyError", message: "API key or endpoint not set. Please set them in the options page." });
      }
    });
  }
  return true;
});
