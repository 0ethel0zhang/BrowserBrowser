// This is the background service worker.
console.log("Background script loaded.");

let currentGoal = "";
let isRunning = false;
let activeTabId: number | null = null;
const MAX_RETRIES = 10; // Maximum number of retries for connecting to the content script

// Function to call the LLM API
async function callLLM(apiKey: string, goal: string, pageContent: string): Promise<any> {
  console.log("Calling LLM with goal:", goal);

  const prompt = `
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
    `;

  const requestBody = {
      contents: [{
          parts: [{
              text: prompt
          }]
      }]
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const data = await response.json();

    // Extract the action from the response
    if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
        const actionText = data.candidates[0].content.parts[0].text;
        return JSON.parse(actionText);
    } else {
        console.error("Unexpected response format from LLM API:", data);
        return { action: "goal_complete" };
    }

  } catch (error) {
    console.error("Error calling LLM API:", error);
    return { action: "goal_complete" };
  }
}

function controlLoop(apiKey: string, tabId: number, retries = 0) {
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
                setTimeout(() => controlLoop(apiKey, tabId, retries + 1), 1000);
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

          callLLM(apiKey, currentGoal, pageContent).then((action) => {
            console.log("Received action from LLM:", action);

            if (action.action === "goal_complete") {
              console.log("Goal is complete.");
              isRunning = false;
              activeTabId = null;
              return;
            }

            chrome.tabs.sendMessage(tabId, { type: "action", action: action }, () => {
              // Reset retries to 0 for the next iteration of the loop
              setTimeout(() => controlLoop(apiKey, tabId, 0), 1000);
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

    chrome.storage.local.get(['apiKey'], (data) => {
      if (data.apiKey) {
        isRunning = true;

        // Find an active tab or create a new one, then start the control loop.
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id) {
            activeTabId = tabs[0].id;
            controlLoop(data.apiKey, activeTabId);
          } else {
            console.log("No active tab found, creating a new one.");
            chrome.tabs.create({ url: "https://www.google.com" }, (newTab) => {
              if (newTab && newTab.id) {
                activeTabId = newTab.id;
                // Wait for the tab to be ready before starting the loop
                setTimeout(() => controlLoop(data.apiKey, activeTabId as number), 1000);
              } else {
                chrome.runtime.sendMessage({ type: "error", message: "Failed to create a new tab." });
                isRunning = false;
              }
            });
          }
        });

      } else {
        chrome.runtime.sendMessage({ type: "error", message: "API key not set. Please set it in the options page." });
      }
    });
  }
  return true;
});
