document.addEventListener("DOMContentLoaded", () => {
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input") as HTMLInputElement;
  const sendButton = document.getElementById("send-button");
  const statusDot = document.getElementById("status-dot");

  // Load state and restore chat
  const restoreState = () => {
    chrome.storage.local.get(["agentState"], (data) => {
      const state = data.agentState;
      if (!state) return;

      if (state.currentGoal) {
        addMessage("user", state.currentGoal);
      }

      if (state.actionHistory) {
        state.actionHistory.forEach((rawAction: string) => {
          try {
            const action = JSON.parse(rawAction);
            if (action.thought) {
              addMessage("system", action.thought);
            }
          } catch (e) { /* skip malformed */ }
        });
      }

      if (state.isRunning) {
        setStatus("running");
      }
    });
  };

  restoreState();

  const sendMessage = () => {
    const message = chatInput.value.trim();
    if (message !== "") {
      // Clear previous states when a new goal starts
      if (chatMessages) chatMessages.innerHTML = "";
      addMessage("user", message);
      chatInput.value = "";
      setStatus("running");
      chrome.runtime.sendMessage({ type: "goal", goal: message });
    }
  };

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      sendMessage();
    }
  });

  sendButton?.addEventListener("click", sendMessage);

  function setStatus(status: "idle" | "running" | "error") {
    if (statusDot) {
      statusDot.className = status;
    }
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "error") {
      addMessage("system", `Error: ${request.message}`);
      setStatus("error");
    } else if (request.type === "thought") {
      addMessage("system", request.thought);
    } else if (request.type === "complete") {
      if (request.thought) {
        addMessage("system", request.thought);
      }
      if (request.thought.includes("AI Error: ")) {
        addMessage("system", "Aborted because of error!");
      } else {
        addMessage("system", "Goal completed!");
      }
      setStatus("idle");
    }
  });

  function addMessage(type: "user" | "system", text: string) {
    if (!chatMessages) return;
    const messageElement = document.createElement("div");
    messageElement.className = `message ${type}`;
    messageElement.textContent = text;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
});
