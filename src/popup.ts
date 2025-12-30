document.addEventListener("DOMContentLoaded", () => {
  const chatMessages = document.getElementById("chat-messages");
  const chatInput = document.getElementById("chat-input") as HTMLInputElement;

  chatInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && chatInput.value.trim() !== "") {
      const message = chatInput.value.trim();
      addMessage("You", message);
      chatInput.value = "";
      chrome.runtime.sendMessage({ type: "goal", goal: message });
    }
  });

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "apiKeyError") {
      addMessage("Agent", request.message);
    }
  });

  function addMessage(sender: string, message: string) {
    if (!chatMessages) return;
    const messageElement = document.createElement("div");
    messageElement.innerHTML = `<strong>${sender}:</strong> ${message}`;
    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
});
