/**
 * @type {WebSocket}
 */
let websocket;
/**
 * @type {any}
 */
let propertyInspectorUuid;
/**
 * @type {any}
 */
let actionContext;
let actionUuid;

/**
 * @type {{ stepSizeNumber: HTMLInputElement; stepSizeRange: HTMLInputElement; priorityMatchers: HTMLTextAreaElement; }}
 */
const elements = {
  stepSizeNumber: document.getElementById("stepSizeNumber"),
  stepSizeRange: document.getElementById("stepSizeRange"),
  priorityMatchers: document.getElementById("priorityMatchers"),
};

window.connectElgatoStreamDeckSocket = (
  /** @type {any} */ inPort,
  /** @type {any} */ inUUID,
  /** @type {any} */ inRegisterEvent,
  /** @type {any} */ inInfo,
  /** @type {string} */ inActionInfo,
) => {
  propertyInspectorUuid = inUUID;
  const actionInfo = JSON.parse(inActionInfo);
  actionContext = actionInfo.context;
  actionUuid = actionInfo.action;
  applyActionSettings(actionInfo.payload?.settings ?? {});

  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
  websocket.addEventListener("open", () => {
    send({ event: inRegisterEvent, uuid: propertyInspectorUuid });
    send({ event: "getSettings", context: actionContext });
    send({ event: "getGlobalSettings", context: propertyInspectorUuid });
  });

  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    switch (message.event) {
      case "didReceiveSettings":
        applyActionSettings(message.payload.settings ?? {});
        break;
      case "didReceiveGlobalSettings":
        applyGlobalSettings(message.payload.settings ?? {});
        break;
    }
  });
};

bindMirroredInputs(
  elements.stepSizeRange,
  elements.stepSizeNumber,
  1,
  25,
  persistGlobalSettings,
);
elements.priorityMatchers.addEventListener("input", () => {
  persistGlobalSettings();
});

function applyActionSettings(settings) {}

/**
 * @param {{ stepSize: any; priorityMatchers: any[]; }} settings
 */
function applyGlobalSettings(settings) {
  setMirroredValue(
    elements.stepSizeRange,
    elements.stepSizeNumber,
    clampNumber(settings.stepSize, 1, 25, 5),
  );
  elements.priorityMatchers.value = Array.isArray(settings.priorityMatchers)
    ? settings.priorityMatchers.join("\n")
    : "";
}

/**
 * @param {HTMLInputElement} rangeInput
 * @param {HTMLInputElement} numberInput
 * @param {number} min
 * @param {number} max
 * @param {() => void} onChange
 */
function bindMirroredInputs(rangeInput, numberInput, min, max, onChange) {
  rangeInput.addEventListener("input", () => {
    setMirroredValue(
      rangeInput,
      numberInput,
      clampNumber(rangeInput.value, min, max, min),
    );
    onChange();
  });

  numberInput.addEventListener("change", () => {
    setMirroredValue(
      rangeInput,
      numberInput,
      clampNumber(numberInput.value, min, max, min),
    );
    onChange();
  });
}

/**
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(`${value}`, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function currentActionSettings() {
  return {};
}

function currentGlobalSettings() {
  return {
    stepSize: clampNumber(elements.stepSizeNumber.value, 1, 25, 5),
    priorityMatchers: parsePriorityMatchers(elements.priorityMatchers.value),
  };
}

/**
 * @param {any} value
 */
function parsePriorityMatchers(value) {
  return `${value}`
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function persistActionSettings() {
  const settings = currentActionSettings();
  send({ event: "setSettings", context: actionContext, payload: settings });
  return settings;
}

function persistGlobalSettings() {
  const settings = currentGlobalSettings();
  send({
    event: "setGlobalSettings",
    context: propertyInspectorUuid,
    payload: settings,
  });
  return settings;
}

function persistSettings() {
  return persistActionSettings();
}

/**
 * @param {{ event: any; uuid?: any; context?: any; payload?: {  } | { stepSize: any; priorityMatchers: string[]; }; }} payload
 */
function send(payload) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  websocket.send(JSON.stringify(payload));
}

/**
 * @param {HTMLInputElement} rangeInput
 * @param {HTMLInputElement} numberInput
 * @param {any} value
 */
function setMirroredValue(rangeInput, numberInput, value) {
  rangeInput.value = `${value}`;
  numberInput.value = `${value}`;
}
