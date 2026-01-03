console.log("Content script loaded.");

// Store image analysis results
const imageAnalysisResults = new Map<string, string>();

function simplifyDOM(analysisResults: Map<string, string>) {
  const interactiveElements = Array.from(document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="link"], img'));
  let simplifiedDOM = "";
  interactiveElements.forEach((el, index) => {
    const element = el as HTMLElement;
    const selector = `[data-agent-selector='${index}']`;
    element.setAttribute('data-agent-selector', String(index));

    const tagName = element.tagName.toLowerCase();
    let text = '';

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      text = element.placeholder || element.ariaLabel || element.name || '';
    } else if (element instanceof HTMLSelectElement) {
      text = element.ariaLabel || element.name || '';
    } else if (element instanceof HTMLImageElement) {
      text = element.alt || element.ariaLabel || '';
    }
    else {
      text = element.innerText || element.ariaLabel || '';
    }

    simplifiedDOM += `<${tagName} selector="${selector}">${text.trim()}</${tagName}>\n`;

    if (analysisResults.has(selector)) {
        const analysisText = analysisResults.get(selector);
        simplifiedDOM += `<div data-analysis-for="${selector}">Image Analysis Result: ${analysisText}</div>\n`;
    }
  });
  return simplifiedDOM;
}

async function getImageData(selector: string): Promise<string> {
  const element = document.querySelector(selector) as HTMLImageElement;
  if (!element || element.tagName !== 'IMG') {
    throw new Error(`Element with selector "${selector}" is not an image.`);
  }

  const imageUrl = new URL(element.src, window.location.href).href;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    throw new Error(`Error fetching or processing image: ${error}`);
  }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Message received in content script:", request);

  if (request.type === "ping") {
    sendResponse({ type: "pong" });
  } else if (request.type === "getDOM") {
    sendResponse({ content: simplifyDOM(imageAnalysisResults) });
  } else if (request.type === "storeAnalysisResult") {
    imageAnalysisResults.set(request.selector, request.analysisText);
    sendResponse({ status: "success" });
  } else if (request.type === "getImageData") {
    getImageData(request.selector)
      .then(data => sendResponse({ status: "success", data }))
      .catch(error => sendResponse({ status: "error", message: error.message }));
    return true;
  } else if (request.type === "action") {
    const { action } = request;
    console.log("Performing action:", action);

    if (action.action === "type") {
      const element = document.querySelector(action.selector) as HTMLInputElement;
      if (element) {
        if (element.type === 'password') {
          console.warn("Refusing to type into a password field.");
        } else {
          element.value = action.text;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    } else if (action.action === "click") {
      const element = document.querySelector(action.selector) as HTMLElement;
      if (element) {
        element.click();
      }
    } else if (action.action === "navigate") {
      window.location.href = action.url;
    } else if (action.action === "scroll") {
      const { selector, direction } = action;
      const element = selector ? document.querySelector(selector) : window;
      if (element) {
        const scrollAmount = direction === "up" ? -window.innerHeight * 0.9 : window.innerHeight * 0.9;
        element.scrollBy(0, scrollAmount);
      }
    }
    sendResponse({ status: "action complete" });
  }
  return true;
});
