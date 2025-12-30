console.log("Content script loaded.");

function simplifyDOM() {
  const interactiveElements = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"]'));
  let simplifiedDOM = "";
  interactiveElements.forEach((el, index) => {
    const element = el as HTMLElement;
    element.setAttribute('data-agent-selector', String(index));

    const tagName = element.tagName.toLowerCase();
    let text = '';

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        text = element.placeholder || element.ariaLabel || element.name || '';
    } else if (element instanceof HTMLSelectElement) {
        text = element.ariaLabel || element.name || '';
    }
    else {
        text = element.innerText || element.ariaLabel || '';
    }

    simplifiedDOM += `<${tagName} selector="[data-agent-selector='${index}']">${text.trim()}</${tagName}>\n`;
  });
  return simplifiedDOM;
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in content script:", request);

  if (request.type === "ping") {
    sendResponse({ type: "pong" });
    return true;
  }

  if (request.type === "getDOM") {
    sendResponse({ content: simplifyDOM() });
    return true;
  }

  if (request.type === "action") {
    const { action } = request;
    console.log("Performing action:", action);

    if (action.action === "type") {
      const element = document.querySelector(action.selector) as HTMLInputElement;
      if (element) {
        if (element.type === 'password') {
          console.warn("Refusing to type into a password field.");
        } else {
          element.value = action.text;
        }
      }
    } else if (action.action === "click") {
      const element = document.querySelector(action.selector) as HTMLElement;
      if (element) {
        element.click();
      }
    } else if (action.action === "navigate") {
      window.location.href = action.url;
    }
    sendResponse({ status: "action complete" });
  }
  return true;
});
