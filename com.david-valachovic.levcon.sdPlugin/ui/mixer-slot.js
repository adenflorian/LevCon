let websocket;
let propertyInspectorUuid;
let actionContext;
let actionUuid;

const elements = {
  previewMeta: document.getElementById("previewMeta"),
  previewStatus: document.getElementById("previewStatus"),
  refreshPreview: document.getElementById("refreshPreview"),
  sessionPreview: document.getElementById("sessionPreview"),
  showApps: document.getElementById("showApps"),
  slotIndexNumber: document.getElementById("slotIndexNumber"),
  slotIndexRange: document.getElementById("slotIndexRange"),
  stepSizeNumber: document.getElementById("stepSizeNumber"),
  stepSizeRange: document.getElementById("stepSizeRange"),
};

window.connectElgatoStreamDeckSocket = (
  inPort,
  inUUID,
  inRegisterEvent,
  inInfo,
  inActionInfo,
) => {
  propertyInspectorUuid = inUUID;
  const actionInfo = JSON.parse(inActionInfo);
  actionContext = actionInfo.context;
  actionUuid = actionInfo.action;

  websocket = new WebSocket(`ws://127.0.0.1:${inPort}`);
  websocket.addEventListener("open", () => {
    send({ event: inRegisterEvent, uuid: propertyInspectorUuid });
    send({ event: "getSettings", context: actionContext });
    requestPreview();
  });

  websocket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    switch (message.event) {
      case "didReceiveSettings":
        applySettings(message.payload.settings ?? {});
        requestPreview();
        break;
      case "sendToPropertyInspector":
        handlePluginMessage(message.payload);
        break;
    }
  });
};

bindMirroredInputs(elements.slotIndexRange, elements.slotIndexNumber, 0, 7);
bindMirroredInputs(elements.stepSizeRange, elements.stepSizeNumber, 1, 25);
elements.showApps.addEventListener("change", persistSettings);
elements.refreshPreview.addEventListener("click", () => requestPreview());

function applySettings(settings) {
  elements.showApps.value = settings.showApps ?? "active";
  setMirroredValue(
    elements.slotIndexRange,
    elements.slotIndexNumber,
    clampNumber(settings.slotIndex, 0, 7, 0),
  );
  setMirroredValue(
    elements.stepSizeRange,
    elements.stepSizeNumber,
    clampNumber(settings.stepSize, 1, 25, 5),
  );
}

function bindMirroredInputs(rangeInput, numberInput, min, max) {
  rangeInput.addEventListener("input", () => {
    setMirroredValue(
      rangeInput,
      numberInput,
      clampNumber(rangeInput.value, min, max, min),
    );
    persistSettings();
  });

  numberInput.addEventListener("change", () => {
    setMirroredValue(
      rangeInput,
      numberInput,
      clampNumber(numberInput.value, min, max, min),
    );
    persistSettings();
  });
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number.parseInt(`${value}`, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function currentSettings() {
  return {
    showApps: elements.showApps.value,
    slotIndex: clampNumber(elements.slotIndexNumber.value, 0, 7, 0),
    stepSize: clampNumber(elements.stepSizeNumber.value, 1, 25, 5),
  };
}

function handlePluginMessage(payload) {
  if (!payload || payload.type !== "preview") {
    return;
  }

  elements.previewStatus.textContent = payload.error ?? "";
  elements.previewMeta.textContent = `Slot ${payload.slotIndex + 1} • Page ${payload.page + 1}/${payload.totalPages} • ${payload.sessionCount} session${payload.sessionCount === 1 ? "" : "s"}`;
  elements.sessionPreview.replaceChildren();

  if (payload.sessions.length === 0) {
    const empty = document.createElement("li");
    empty.textContent = payload.error
      ? "Preview unavailable."
      : "No sessions match this filter.";
    elements.sessionPreview.append(empty);
    return;
  }

  for (const session of payload.sessions) {
    const item = document.createElement("li");
    if (session.id === payload.currentSessionId) {
      item.classList.add("current");
    }

    const name = document.createElement("div");
    name.className = "session-name";
    name.textContent = session.displayName;

    const meta = document.createElement("div");
    meta.className = "session-meta";
    meta.textContent = `${session.processName || "unknown"} • pid ${session.processId ?? "n/a"} • ${session.volume}%${session.muted ? " • muted" : ""}${session.active ? " • active" : ""}${session.recentlyActive === false ? " • dimmed" : ""}`;

    const details = document.createElement("div");
    details.className = "session-details";
    appendDetail(details, "ID", session.id);
    appendDetail(details, "Session ID", session.sessionIdentifier);
    appendDetail(details, "Instance ID", session.sessionInstanceIdentifier);
    appendDetail(details, "Grouping", session.groupingParam);
    appendDetail(details, "State", session.state);
    appendDetail(details, "Peak", formatPeakValue(session.peakValue));
    appendDetail(details, "System Session", formatBoolean(session.isSystemSoundsSession));
    appendDetail(details, "Recent Activity", formatBoolean(session.recentlyActive));

    item.append(name, meta, details);
    elements.sessionPreview.append(item);
  }
}

function appendDetail(container, label, value) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  const row = document.createElement("div");

  const detailLabel = document.createElement("span");
  detailLabel.className = "session-detail-label";
  detailLabel.textContent = `${label}:`;

  const detailValue = document.createElement("span");
  detailValue.textContent = `${value}`;

  row.append(detailLabel, detailValue);
  container.append(row);
}

function formatBoolean(value) {
  if (value === undefined) {
    return undefined;
  }

  return value ? "yes" : "no";
}

function formatPeakValue(value) {
  if (typeof value !== "number") {
    return undefined;
  }

  return value.toFixed(4);
}

function persistSettings() {
  const settings = currentSettings();
  send({ event: "setSettings", context: actionContext, payload: settings });
  requestPreview(settings);
}

function requestPreview(settings = currentSettings()) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  elements.previewStatus.textContent = "Loading preview...";
  send({
    event: "sendToPlugin",
    action: actionUuid,
    context: actionContext,
    payload: {
      type: "requestPreview",
      settings,
    },
  });
}

function send(payload) {
  if (!websocket || websocket.readyState !== WebSocket.OPEN) {
    return;
  }

  websocket.send(JSON.stringify(payload));
}

function setMirroredValue(rangeInput, numberInput, value) {
  rangeInput.value = `${value}`;
  numberInput.value = `${value}`;
}
