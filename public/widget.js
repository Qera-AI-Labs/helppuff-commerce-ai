(function () {
  var WIDGET_ID = "helppuff-widget";
  var sessionId = "vis-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  var isOpen = false;
  var messages = [];

  function getApiBase() {
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (src.indexOf("widget.js") !== -1) {
        var base = src.split("?")[0].replace(/widget\.js.*$/, "");
        return base;
      }
    }
    return "/";
  }

  var API_BASE = getApiBase();

  function injectStyles() {
    var css = `
      #${WIDGET_ID}-btn {
        position: fixed; bottom: 20px; right: 20px; z-index: 999998;
        width: 56px; height: 56px; border-radius: 50%;
        background: linear-gradient(135deg, #5E6AD2, #3A45A8);
        border: none; cursor: pointer; color: white;
        box-shadow: 0 4px 12px rgba(94,106,210,0.4);
        display: flex; align-items: center; justify-content: center;
        font-size: 24px; font-family: Inter, sans-serif; font-weight: 700;
        transition: transform 0.2s;
      }
      #${WIDGET_ID}-btn:hover { transform: scale(1.05); }
      #${WIDGET_ID}-panel {
        position: fixed; bottom: 88px; right: 20px; z-index: 999999;
        width: 360px; max-width: calc(100vw - 40px); height: 480px; max-height: calc(100vh - 120px);
        background: #fff; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.15);
        display: none; flex-direction: column; overflow: hidden;
        font-family: Inter, -apple-system, BlinkMacSystemFont, sans-serif;
      }
      #${WIDGET_ID}-panel.open { display: flex; }
      #${WIDGET_ID}-header {
        background: linear-gradient(135deg, #5E6AD2, #3A45A8); color: white;
        padding: 14px 16px; font-size: 14px; font-weight: 600; display: flex;
        align-items: center; justify-content: space-between;
      }
      #${WIDGET_ID}-close { background: none; border: none; color: white; cursor: pointer; font-size: 18px; }
      #${WIDGET_ID}-messages {
        flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
        background: #f8fafc;
      }
      .${WIDGET_ID}-msg { max-width: 85%; padding: 8px 12px; border-radius: 8px; font-size: 13px; line-height: 1.5; }
      .${WIDGET_ID}-msg.user { align-self: flex-end; background: #5E6AD2; color: white; }
      .${WIDGET_ID}-msg.assistant { align-self: flex-start; background: #fff; border: 1px solid #e2e8f0; color: #0f172a; }
      #${WIDGET_ID}-input-area { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff; }
      #${WIDGET_ID}-input { flex: 1; height: 36px; padding: 0 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; font-family: inherit; outline: none; }
      #${WIDGET_ID}-input:focus { border-color: #5E6AD2; }
      #${WIDGET_ID}-send { height: 36px; padding: 0 14px; border: none; border-radius: 6px; background: #5E6AD2; color: white; font-size: 13px; cursor: pointer; font-family: inherit; }
      #${WIDGET_ID}-send:disabled { opacity: 0.5; }
      .${WIDGET_ID}-typing { font-size: 12px; color: #94a3b8; padding: 4px 12px; }
    `;
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createWidget() {
    injectStyles();

    var btn = document.createElement("button");
    btn.id = WIDGET_ID + "-btn";
    btn.textContent = "H";
    btn.onclick = togglePanel;
    document.body.appendChild(btn);

    var panel = document.createElement("div");
    panel.id = WIDGET_ID + "-panel";
    panel.innerHTML = `
      <div id="${WIDGET_ID}-header">
        <span>HelpPuff Assistant</span>
        <button id="${WIDGET_ID}-close">&times;</button>
      </div>
      <div id="${WIDGET_ID}-messages"></div>
      <div id="${WIDGET_ID}-input-area">
        <input type="text" id="${WIDGET_ID}-input" placeholder="Ask a question..." />
        <button id="${WIDGET_ID}-send">Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById(WIDGET_ID + "-close").onclick = togglePanel;
    document.getElementById(WIDGET_ID + "-send").onclick = sendMessage;
    var input = document.getElementById(WIDGET_ID + "-input");
    input.onkeydown = function (e) { if (e.key === "Enter") sendMessage(); };

    addMessage("assistant", "Hi! I'm the HelpPuff assistant. How can I help you today?");
  }

  function togglePanel() {
    isOpen = !isOpen;
    var panel = document.getElementById(WIDGET_ID + "-panel");
    if (panel) panel.classList.toggle("open", isOpen);
    if (isOpen) {
      var input = document.getElementById(WIDGET_ID + "-input");
      if (input) input.focus();
    }
  }

  function addMessage(role, content) {
    messages.push({ role: role, content: content });
    var container = document.getElementById(WIDGET_ID + "-messages");
    if (!container) return;
    var div = document.createElement("div");
    div.className = WIDGET_ID + "-msg " + role;
    div.textContent = content;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function showTyping() {
    var container = document.getElementById(WIDGET_ID + "-messages");
    if (!container) return;
    var div = document.createElement("div");
    div.className = WIDGET_ID + "-typing";
    div.id = WIDGET_ID + "-typing";
    div.textContent = "Assistant is typing...";
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  function hideTyping() {
    var el = document.getElementById(WIDGET_ID + "-typing");
    if (el) el.remove();
  }

  function sendMessage() {
    var input = document.getElementById(WIDGET_ID + "-input");
    var sendBtn = document.getElementById(WIDGET_ID + "-send");
    var msg = input.value.trim();
    if (!msg) return;
    addMessage("user", msg);
    input.value = "";
    sendBtn.disabled = true;
    showTyping();

    fetch(API_BASE + "api/visitor/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg, sessionId: sessionId }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        hideTyping();
        if (data.response) addMessage("assistant", data.response);
        else if (data.error) addMessage("assistant", "Sorry, I couldn't process that. " + (data.details || ""));
      })
      .catch(function () {
        hideTyping();
        addMessage("assistant", "Sorry, something went wrong. Please try again.");
      })
      .finally(function () { sendBtn.disabled = false; });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", createWidget);
  } else {
    createWidget();
  }
})();
