let clickBtn = document.getElementById("input-btn");
let ulEl = document.getElementById("ul-el");

clickBtn.addEventListener("click", function () {
  // Get current tab URL
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    let currentUrl = tabs[0].url;
    
    if (!currentUrl) {
      alert("Could not get current URL");
      return;
    }
    
    // Get existing URLs from chrome.storage.sync
    chrome.storage.sync.get(["savedUrls"], function(result) {
      let urls = result.savedUrls || [];
      
      // Check if URL already saved
      if (urls.includes(currentUrl)) {
        alert("URL already saved!");
        return;
      }
      
      // Add new URL
      urls.push(currentUrl);
      chrome.storage.sync.set({savedUrls: urls});
      let li = document.createElement("li");
      li.textContent = currentUrl;
      ulEl.appendChild(li);
    });
  });
});


// Load saved URLs on page load
chrome.storage.sync.get(["savedUrls"], function(result) {
  let urls = result.savedUrls || [];
  urls.forEach(url => {
    let li = document.createElement("li");
    li.textContent = url;
    ulEl.appendChild(li);
  });
});
