// This is the background service worker.
console.log("Background script loaded.");

let currentGoal = "";
let isRunning = false;
let activeTabId: number | null = null;
let actionHistory: string[] = [];
let stepCount = 0;
const MAX_STEPS = 20;
const MAX_RETRIES = 10;

// Helper function to robustly parse JSON from LLM response
function robustParseJSON(text: string): any {
  try {
    // Attempt 1: Direct parse
    return JSON.parse(text);
  } catch (e) {
    // Attempt 2: Extract JSON-like block using braces
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        // Attempt 3: If it starts with 'thought', wrap it in braces and try fixed-up parse
        if (text.trim().startsWith('thought')) {
          // This handles cases where the model might omit the opening brace
          const fixedText = `{ "${text.trim().replace(/^thought\s*/, 'thought": "')}" }`;
          try {
            return JSON.parse(fixedText);
          } catch (e3) { /* continue */ }
        }
      }
    }
    throw new Error("Could not extract valid JSON from response");
  }
}

// Function to call the LLM API using the latest best practices (JSON mode + System Instructions)
async function callLLM(apiKey: string, goal: string, pageContent: string, history: string[]): Promise<any> {
  console.log("Calling LLM with goal:", goal);

  const systemPrompt = `
      You are an intelligent web agent.
      Your goal is to complete a sequence of actions that will contribute to the completion of the user's goal.

      The current state of the page is represented by a simplified DOM of interactive elements.
      Each element has a \`selector\` attribute that you must use to identify it in your action.
      
      You MUST respond with a JSON object containing a "thought" and an "action".
      The "thought" should explain your reasoning.
      
      Schema:
      - thought: string
      - action: "type" | "click" | "scroll" | "navigate" | "goal_complete"
      - selector: string (for type, click, scroll)
      - text: string (for type)
      - url: string (for navigate)
      - direction: "up" | "down" (for scroll)

      Action Guidelines:
      - Be efficient: Take the shortest path to the goal.
      - Avoid loops: Look at the History provided and do not repeat ineffective actions.
      - If the page has the answer to the goal, return goal_complete.
      - Ignore irrelevant links (Login, Donate, etc.) unless essential.
    `;

  const userPrompt = `
      Goal: "${goal}"
      History (last 5 actions): ${JSON.stringify(history)}
      Simplified DOM:
      ${pageContent}

      What is the next action to take? Respond with a single JSON object.
  `;

  const requestBody = {
    contents: [{
      parts: [{
        text: userPrompt
      }]
    }],
    system_instruction: {
      parts: [{
        text: systemPrompt
      }]
    },
    generationConfig: {
      response_mime_type: "application/json",
      response_schema: {
        type: "OBJECT",
        properties: {
          thought: { type: "STRING" },
          action: { type: "STRING", enum: ["type", "click", "scroll", "navigate", "goal_complete"] },
          selector: { type: "STRING" },
          text: { type: "STRING" },
          url: { type: "STRING" },
          direction: { type: "STRING", enum: ["up", "down"] }
        },
        required: ["thought", "action"]
      }
    }
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || `API request failed with status ${response.status}`;
      throw new Error(errorMessage);
    }

    const data = await response.json();

    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      const actionText = data.candidates[0].content.parts[0].text;
      try {
        return robustParseJSON(actionText);
      } catch (e) {
        console.error("Failed to parse JSON from LLM response. Raw text:", actionText);
        chrome.runtime.sendMessage({ type: "error", message: "Failed to understand the AI's response format." });
        return { action: "goal_complete", thought: "Failed to parse AI response." };
      }
    } else {
      console.error("Unexpected response format from LLM API:", data);
      chrome.runtime.sendMessage({ type: "error", message: "Received empty response from AI." });
      return { action: "goal_complete", thought: "Received empty response from AI." };
    }

  } catch (error: any) {
    console.error("Error calling LLM API:", error);
    chrome.runtime.sendMessage({ type: "error", message: `AI Error: ${error.message}` });
    return { action: "goal_complete", thought: `AI Error: ${error.message}` };
  }
}

// Function to check if a URL is protected
function isProtectedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:");
}

// Function to ensure content script is injected
async function ensureContentScript(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isProtectedUrl(tab.url)) {
      console.warn(`Tab ${tabId} has a protected URL: ${tab.url}. Skipping injection.`);
      return false;
    }

    // Try to ping the content script
    const response: any = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: "ping" }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(resp);
        }
      });
    });

    if (response && response.type === "pong") {
      return true;
    }

    // If ping failed, try to inject the script
    console.log(`Content script not responsive on tab ${tabId}. Attempting injection...`);
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ["dist/content.js"]
    });

    // Brief wait for script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
  } catch (error) {
    console.error("Failed to ensure content script:", error);
    return false;
  }
}

// Safe message sending to handle cases where the popup is closed
function safeSendMessage(message: any) {
  chrome.runtime.sendMessage(message, () => {
    if (chrome.runtime.lastError) {
      // Ignore: receiving end doesn't exist (popup closed)
    }
  });
}

// Persist agent state to storage
async function persistState() {
  await chrome.storage.local.set({
    agentState: {
      currentGoal,
      isRunning,
      stepCount,
      actionHistory,
      lastUpdate: Date.now()
    }
  });
}

async function controlLoop(apiKey: string, tabId: number, retries = 0) {
  if (!isRunning) {
    activeTabId = null;
    await persistState();
    return;
  }

  // Increment and check step count
  stepCount++;
  if (stepCount > MAX_STEPS) {
    console.error("MAX_STEPS reached. Aborting task.");
    const errorMsg = "Task took too many steps. Aborted to prevent loop.";
    safeSendMessage({ type: "error", message: errorMsg });
    isRunning = false;
    activeTabId = null;
    await persistState();
    return;
  }

  // Check if the tab still exists before proceeding
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab) throw new Error("Tab not found");
  } catch (e) {
    console.error(`Target tab with ID ${tabId} not found. Stopping task.`);
    const errorMsg = "The tab was closed. Task stopped.";
    safeSendMessage({ type: "error", message: errorMsg });
    isRunning = false;
    activeTabId = null;
    await persistState();
    return;
  }

  // Ensure content script is ready
  const isReady = await ensureContentScript(tabId);
  if (!isReady) {
    if (retries >= MAX_RETRIES) {
      console.error("Content script not ready after injection. Stopping goal.");
      const errorMsg = "Could not connect to the page. It may be a protected page (e.g., chrome://). Task stopped.";
      safeSendMessage({ type: "error", message: errorMsg });
      isRunning = false;
      activeTabId = null;
      await persistState();
    } else {
      console.warn(`Retrying content script handshake... (${retries + 1}/${MAX_RETRIES})`);
      setTimeout(() => controlLoop(apiKey, tabId, retries + 1), 1000);
    }
    return;
  }

  // Content script is ready, proceed with getDOM
  chrome.tabs.sendMessage(tabId, { type: "getDOM" }, async (domResponse) => {
    if (chrome.runtime.lastError || !domResponse) {
      console.error("Error getting DOM:", chrome.runtime.lastError);
      isRunning = false;
      activeTabId = null;
      await persistState();
      return;
    }

    const pageContent = domResponse.content;
    const actionResponse = await callLLM(apiKey, currentGoal, pageContent, actionHistory);
    console.log("Received action response from LLM:", actionResponse);

    if (actionResponse.action === "goal_complete") {
      console.log("Goal is complete. Reason:", actionResponse.thought);
      safeSendMessage({ type: "complete", thought: actionResponse.thought });
      isRunning = false;
      activeTabId = null;
      // Add completion thought to history
      actionHistory.push(JSON.stringify({ thought: actionResponse.thought, action: "goal_complete" }));
      await persistState();
      return;
    }

    // Add to history (keep last 5)
    actionHistory.push(JSON.stringify(actionResponse));
    if (actionHistory.length > 5) actionHistory.shift();

    // Persist mid-task state
    await persistState();

    // Notify popup of the current thought
    safeSendMessage({ type: "thought", thought: actionResponse.thought });

    // Perform action
    chrome.tabs.sendMessage(tabId, { type: "action", action: actionResponse }, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error performing action:", chrome.runtime.lastError);
      }
      // Continue loop
      setTimeout(() => controlLoop(apiKey, tabId, 0), 1000);
    });
  });
}

// Configure side panel behavior
(chrome as any).sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: any) => console.error(error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in background script:", request);
  if (request.type === "goal") {
    if (isRunning) {
      console.log("Already running, ignoring new goal.");
      return true;
    }
    console.log("Received new goal:", request.goal);
    currentGoal = request.goal;

    // Reset state for new goal
    actionHistory = [];
    stepCount = 0;

    chrome.storage.local.get(['apiKey'], (data) => {
      if (data.apiKey) {
        isRunning = true;

        // Intelligent Tab Selection
        chrome.tabs.query({ currentWindow: true }, (tabs) => {
          const validTabs = tabs.filter(tab => !isProtectedUrl(tab.url));
          const activeTab = tabs.find(tab => tab.active);

          let targetTabId: number | undefined;

          if (activeTab && !isProtectedUrl(activeTab.url)) {
            // Priority 1: Current active tab is valid
            console.log("Current active tab is valid, using it.");
            targetTabId = activeTab.id;
          } else if (validTabs.length > 0) {
            // Priority 2: Use another existing valid tab
            console.log("Active tab is protected, but found another valid tab. Switching...");
            targetTabId = validTabs[0].id;
            if (targetTabId) {
              chrome.tabs.update(targetTabId, { active: true });
            }
          }

          if (targetTabId) {
            activeTabId = targetTabId;
            controlLoop(data.apiKey, activeTabId);
          } else {
            // Priority 3: No valid tab found, create a new one
            console.log("No valid tabs found in current window, creating a new one.");
            chrome.tabs.create({ url: "https://www.google.com" }, (newTab) => {
              if (newTab && newTab.id) {
                activeTabId = newTab.id;
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
