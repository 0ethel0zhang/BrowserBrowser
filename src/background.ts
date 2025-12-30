// This is the background service worker.
console.log("Background script loaded.");

let currentGoal = "";
let isRunning = false;
let activeTabId: number | null = null;
const MAX_RETRIES = 10; // Maximum number of retries for connecting to the content script

// Function to call the LLM API
async function callLLM(apiKey: string, apiEndpoint: string, goal: string, pageContent: string): Promise<any> {
  console.log("Calling LLM with goal:", goal);

  const requestBody = {
    prompt: `
      You are an intelligent web agent.
      Your goal is: "${goal}"

      The current state of the page is represented by a simplified DOM of interactive elements.
      Each element has a \`selector\` attribute that you must use to identify it in your action.
      Simplified DOM:
      ${pageContent}

      Based on the simplified DOM and your goal, what is the next action to take?
      Respond with a JSON object with one of the following actions:
      - { "action": "type", "selector": "[data-agent-selector='...']", "text": "text-to-type" }
      - { "action": "click", "selector": "[data-agent-selector='...']" }
      - { "action": "scroll", "selector": "[data-agent-selector='...']", "direction": "up" | "down" } // Use selector for a specific element, or omit for window scroll
      - { "action": "navigate", "url": "url-to-navigate-to" }
      - { "action": "goal_complete" }

      You MUST use the selector provided in the simplified DOM where applicable.
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

function controlLoop(apiKey: string, apiEndpoint: string, tabId: number, retries = 0) {
  if (!isRunning) {
    activeTabId = null;
    return;
  }

  // Check if the tab still exists before proceeding
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab) {
        console.error(`Target tab with ID ${tabId} not found. Stopping task.`);
        chrome.runtime.sendMessage({ type: "error", message: `The tab was closed. Task stopped.` });
        isRunning = false;
        activeTabId = null;
        return;
    }

    // Handshake with content script
    chrome.tabs.sendMessage(tabId, { type: "ping" }, (response) => {
        if (chrome.runtime.lastError || !response || response.type !== "pong") {
            if (retries >= MAX_RETRIES) {
                console.error("Content script not ready after multiple retries. Stopping goal.");
                chrome.runtime.sendMessage({ type: "error", message: "Could not connect to the page. It may be a protected page (e.g., chrome://) or has not loaded. Task stopped." });
                isRunning = false;
                activeTabId = null;
            } else {
                console.warn(`Content script not ready on tab ${tabId}. Retrying... (${retries + 1}/${MAX_RETRIES})`);
                setTimeout(() => controlLoop(apiKey, apiEndpoint, tabId, retries + 1), 1000);
            }
            return;
        }

        // Content script is ready, proceed with getDOM
        chrome.tabs.sendMessage(tabId, { type: "getDOM" }, (domResponse) => {
          if (chrome.runtime.lastError) {
            console.error(chrome.runtime.lastError);
            isRunning = false;
            activeTabId = null;
            return;
          }
          const pageContent = domResponse.content;

          callLLM(apiKey, apiEndpoint, currentGoal, pageContent).then((action) => {
            console.log("Received action from LLM:", action);

            if (action.action === "goal_complete") {
              console.log("Goal is complete.");
              isRunning = false;
              activeTabId = null;
              return;
            }

            chrome.tabs.sendMessage(tabId, { type: "action", action: action }, () => {
              // Reset retries to 0 for the next iteration of the loop
              setTimeout(() => controlLoop(apiKey, apiEndpoint, tabId, 0), 1000);
            });
          });
        });
    });
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

        // Find an active tab or create a new one, then start the control loop.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            activeTabId = tabs[0].id;
            controlLoop(data.apiKey, data.apiEndpoint, activeTabId);
          } else {
            console.log("No active tab found, creating a new one.");
            chrome.tabs.create({ url: "https://www.google.com" }, (newTab) => {
              if (newTab && newTab.id) {
                activeTabId = newTab.id;
                // Wait for the tab to be ready before starting the loop
                setTimeout(() => controlLoop(data.apiKey, data.apiEndpoint, activeTabId as number), 1000);
              } else {
                chrome.runtime.sendMessage({ type: "error", message: "Failed to create a new tab." });
                isRunning = false;
              }
            });
          }
        });

      } else {
        chrome.runtime.sendMessage({ type: "error", message: "API key or endpoint not set. Please set them in the options page." });
      }
    });
  }
  return true;
});
