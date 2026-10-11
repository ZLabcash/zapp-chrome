// The service worker: keeps the offscreen document (and so the engine worker that syncs the
// wallets) alive while the browser is open. iOS wakes ZApp now and then to sync; here the
// engine simply keeps running, and an alarm brings it back if Chrome closed it.

const OFFSCREEN = "offscreen.html";

async function ensureEngine() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  if (contexts.length) return;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Syncs the Zcash wallets with the network in a worker.",
    });
  } catch (e) {
    // Two callers at once: the second finds it created.
    if (!String(e).includes("single offscreen")) throw e;
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await ensureEngine();
  chrome.alarms.create("engine", { periodInMinutes: 1 });
  // First install: open the welcome page, as ZApp opens on its onboarding.
  if (details.reason === "install") chrome.tabs.create({ url: "app.html" });
});

chrome.runtime.onStartup.addListener(() => {
  ensureEngine();
  chrome.alarms.create("engine", { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "engine") ensureEngine();
});

// The popup or the app page asks for the engine before connecting to it.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === "ensure-engine") {
    ensureEngine().then(() => reply(true), (e) => reply(String(e)));
    return true;
  }
});
