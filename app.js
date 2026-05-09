const session = {
  playerId: sessionStorage.getItem("draw-battle-player-id") || "",
  playerName: localStorage.getItem("draw-battle-player-name") || "",
};

const state = {
  room: null,
  eventSource: null,
  timerHandle: null,
  activeTool: "pen",
  color: "#151515",
  size: 4,
  pointerStrokeId: "",
  isDrawing: false,
  pointerActive: false,
  chatTab: "guess",
};

const welcomeScreen = document.querySelector("#welcomeScreen");
const gameScreen = document.querySelector("#gameScreen");
const playerNameInput = document.querySelector("#playerNameInput");
const roomCodeInput = document.querySelector("#roomCodeInput");
const createRoomButton = document.querySelector("#createRoomButton");
const joinRoomButton = document.querySelector("#joinRoomButton");
const roomCodeLabel = document.querySelector("#roomCodeLabel");
const phaseLabel = document.querySelector("#phaseLabel");
const timerLabel = document.querySelector("#timerLabel");
const roundsSelect = document.querySelector("#roundsSelect");
const startGameButton = document.querySelector("#startGameButton");
const leaveRoomButton = document.querySelector("#leaveRoomButton");
const playerCountLabel = document.querySelector("#playerCountLabel");
const playersList = document.querySelector("#playersList");
const roundLabel = document.querySelector("#roundLabel");
const wordLabel = document.querySelector("#wordLabel");
const wordChoicePanel = document.querySelector("#wordChoicePanel");
const toolButtons = Array.from(document.querySelectorAll(".tool-button"));
const colorInput = document.querySelector("#colorInput");
const sizeInput = document.querySelector("#sizeInput");
const clearBoardButton = document.querySelector("#clearBoardButton");
const boardCanvas = document.querySelector("#boardCanvas");
const boardFrame = document.querySelector("#boardFrame");
const boardOverlay = document.querySelector("#boardOverlay");
const chatList = document.querySelector("#chatList");
const chatEyebrow = document.querySelector("#chatEyebrow");
const chatTitle = document.querySelector("#chatTitle");
const guessTabButton = document.querySelector("#guessTabButton");
const roomTabButton = document.querySelector("#roomTabButton");
const guessForm = document.querySelector("#guessForm");
const guessInput = document.querySelector("#guessInput");
const roomChatForm = document.querySelector("#roomChatForm");
const roomChatInput = document.querySelector("#roomChatInput");

const ctx = boardCanvas.getContext("2d");
const resizeObserver = new ResizeObserver(() => renderBoard());
resizeObserver.observe(boardFrame);

createRoomButton.addEventListener("click", () => createRoom());
joinRoomButton.addEventListener("click", () => joinRoom());
startGameButton.addEventListener("click", () => sendAction("start-game"));
leaveRoomButton.addEventListener("click", leaveRoom);
roundsSelect.addEventListener("change", () => sendAction("set-rounds", { rounds: Number(roundsSelect.value) }));
colorInput.addEventListener("input", () => {
  state.color = colorInput.value;
});
sizeInput.addEventListener("input", () => {
  state.size = Number(sizeInput.value);
});
clearBoardButton.addEventListener("click", () => sendAction("clear-board"));
guessForm.addEventListener("submit", handleGuessSubmit);
roomChatForm.addEventListener("submit", handleRoomChatSubmit);
guessTabButton.addEventListener("click", () => switchChatTab("guess"));
roomTabButton.addEventListener("click", () => switchChatTab("room"));

toolButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.activeTool = button.dataset.tool;
    toolButtons.forEach((item) => item.classList.toggle("active", item === button));
  });
});

boardCanvas.addEventListener("pointerdown", handlePointerDown);
boardCanvas.addEventListener("pointermove", handlePointerMove);
boardCanvas.addEventListener("pointerup", handlePointerUp);
boardCanvas.addEventListener("pointerleave", handlePointerUp);
boardCanvas.addEventListener("pointercancel", handlePointerUp);

window.addEventListener("beforeunload", () => {
  if (!session.playerId) {
    return;
  }
  navigator.sendBeacon(
    "/api/rooms/leave",
    new Blob([JSON.stringify({ playerId: session.playerId })], { type: "application/json" })
  );
});

render();
restoreSession();
playerNameInput.value = session.playerName;

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Falha na requisição.");
  }
  return payload;
}

function requireName() {
  const value = playerNameInput.value.trim();
  if (!value) {
    playerNameInput.focus();
    throw new Error("Informe seu nome.");
  }
  session.playerName = value;
  localStorage.setItem("draw-battle-player-name", value);
  return value;
}

async function createRoom() {
  try {
    const playerName = requireName();
    const payload = await api("/api/rooms/create", {
      method: "POST",
      body: { playerName },
    });
    connectToRoom(payload.playerId, payload.room);
  } catch (error) {
    window.alert(error.message);
  }
}

async function joinRoom() {
  try {
    const playerName = requireName();
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!roomCode) {
      roomCodeInput.focus();
      throw new Error("Informe o código da sala.");
    }
    const payload = await api("/api/rooms/join", {
      method: "POST",
      body: { playerName, roomCode },
    });
    connectToRoom(payload.playerId, payload.room);
  } catch (error) {
    window.alert(error.message);
  }
}

function connectToRoom(playerId, room) {
  session.playerId = playerId;
  sessionStorage.setItem("draw-battle-player-id", playerId);
  setRoom(room);
  openEvents();
}

function openEvents() {
  if (!session.playerId) {
    return;
  }
  state.eventSource?.close();
  const events = new EventSource(`/api/events?playerId=${encodeURIComponent(session.playerId)}`);
  events.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.type === "room-state") {
      setRoom(payload.room);
    }
  };
  events.onerror = async () => {
    events.close();
    state.eventSource = null;
    try {
      const payload = await api(`/api/state?playerId=${encodeURIComponent(session.playerId)}`);
      setRoom(payload.room);
      setTimeout(openEvents, 800);
    } catch {
      resetSession();
    }
  };
  state.eventSource = events;
}

async function leaveRoom() {
  if (!session.playerId) {
    resetSession();
    return;
  }
  try {
    await api("/api/rooms/leave", {
      method: "POST",
      body: { playerId: session.playerId },
    });
  } catch {
    // Ignore leave failures on manual exit.
  }
  resetSession();
}

function resetSession() {
  state.eventSource?.close();
  state.eventSource = null;
  session.playerId = "";
  sessionStorage.removeItem("draw-battle-player-id");
  state.room = null;
  render();
}

function setRoom(room) {
  state.room = room;
  roundsSelect.value = String(room.rounds || 3);
  render();
}

async function sendAction(type, payload = {}) {
  if (!session.playerId) {
    return;
  }
  try {
    await api("/api/action", {
      method: "POST",
      body: {
        playerId: session.playerId,
        type,
        payload,
      },
    });
  } catch (error) {
    window.alert(error.message);
  }
}

async function handleGuessSubmit(event) {
  event.preventDefault();
  const text = guessInput.value.trim();
  if (!text) {
    return;
  }
  guessInput.value = "";
  await sendAction("guess", { text });
}

async function handleRoomChatSubmit(event) {
  event.preventDefault();
  const text = roomChatInput.value.trim();
  if (!text) {
    return;
  }
  roomChatInput.value = "";
  await sendAction("room-message", { text });
}

function switchChatTab(tab) {
  state.chatTab = tab;
  guessTabButton.classList.toggle("active", tab === "guess");
  roomTabButton.classList.toggle("active", tab === "room");
  guessForm.classList.toggle("hidden", tab !== "guess");
  roomChatForm.classList.toggle("hidden", tab !== "room");
  chatEyebrow.textContent = tab === "guess" ? "Palpites" : "Sala";
  chatTitle.textContent = tab === "guess" ? "Chat da rodada" : "Chat da sala";
  if (state.room) {
    renderChat(state.room);
  }
}

function canDraw() {
  return Boolean(
    state.room &&
      state.room.me &&
      state.room.drawerId === state.room.me.id &&
      state.room.phase === "playing"
  );
}

function normalizePointer(event) {
  const rect = boardCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
  };
}

function pointerPayload(point) {
  return {
    id: state.pointerStrokeId,
    tool: state.activeTool,
    color: state.activeTool === "eraser" ? "#ffffff" : state.color,
    size: Number(state.size),
    x: point.x,
    y: point.y,
  };
}

function handlePointerDown(event) {
  if (!canDraw()) {
    return;
  }
  event.preventDefault();
  state.pointerActive = true;
  state.pointerStrokeId = crypto.randomUUID();
  boardCanvas.setPointerCapture(event.pointerId);
  sendAction("begin-stroke", pointerPayload(normalizePointer(event)));
}

function handlePointerMove(event) {
  if (!state.pointerActive || !canDraw()) {
    return;
  }
  sendAction("extend-stroke", pointerPayload(normalizePointer(event)));
}

function handlePointerUp(event) {
  if (!state.pointerActive || !canDraw()) {
    return;
  }
  state.pointerActive = false;
  sendAction("end-stroke", pointerPayload(normalizePointer(event)));
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function phaseText(room) {
  const map = {
    lobby: "Lobby",
    choosing: "Escolhendo palavra",
    playing: "Desenhando",
    roundEnd: "Fim da rodada",
    finished: "Partida encerrada",
  };
  return map[room.phase] || "Sala";
}

function render() {
  const hasRoom = Boolean(state.room);
  welcomeScreen.classList.toggle("hidden", hasRoom);
  gameScreen.classList.toggle("hidden", !hasRoom);

  if (!hasRoom) {
    renderBoardEmpty();
    return;
  }

  const room = state.room;
  roomCodeLabel.textContent = room.roomCode;
  phaseLabel.textContent = phaseText(room);
  playerCountLabel.textContent = `${room.players.length}/${room.maxPlayers}`;
  roundLabel.textContent =
    room.phase === "lobby"
      ? "Aguardando"
      : `Rodada ${room.roundNumber}/${room.rounds} · ${room.drawerName || "-"}`;

  renderPlayers(room);
  renderWord(room);
  renderChat(room);
  renderWordChoices(room);
  renderControls(room);
  renderOverlay(room);
  renderBoard();
  startCountdown();
}

function renderPlayers(room) {
  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  playersList.innerHTML = ranking
    .map((player, index) => {
      const badges = [
        player.isHost ? "Host" : "",
        player.isDrawer ? "Desenha" : "",
        player.hasGuessed ? "Acertou" : "",
        !player.connected ? "Offline" : "",
      ]
        .filter(Boolean)
        .join(" · ");

      return `
        <article class="player-card ${player.id === room.me?.id ? "player-card--me" : ""}">
          <div>
            <strong>${index + 1}. ${escapeHtml(player.name)}</strong>
            <p>${badges || "Na disputa"}</p>
          </div>
          <span>${player.score} pts</span>
        </article>
      `;
    })
    .join("");
}

function renderWord(room) {
  if (room.phase === "choosing" && room.drawerId === room.me?.id) {
    wordLabel.textContent = "Escolha uma palavra abaixo";
    return;
  }

  if (room.phase === "playing" && room.drawerId === room.me?.id) {
    wordLabel.textContent = room.chosenWord || "Desenhe";
    return;
  }

  if (room.phase === "playing") {
    wordLabel.textContent = room.wordHint || "Adivinhe";
    return;
  }

  if (room.phase === "roundEnd" || room.phase === "finished") {
    wordLabel.textContent = room.revealedWord || "Rodada encerrada";
    return;
  }

  wordLabel.textContent = "Aguardando jogadores";
}

function renderWordChoices(room) {
  const shouldShow = room.phase === "choosing" && room.drawerId === room.me?.id;
  wordChoicePanel.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) {
    wordChoicePanel.innerHTML = "";
    return;
  }

  wordChoicePanel.innerHTML = `
    <div class="panel-head">
      <div>
        <p class="eyebrow">Sua vez</p>
        <h3>Escolha a palavra</h3>
      </div>
    </div>
    <div class="word-options">
      ${room.wordOptions
        .map(
          (word) => `<button class="word-option" type="button" data-word="${escapeHtml(word)}">${escapeHtml(word)}</button>`
        )
        .join("")}
    </div>
  `;

  wordChoicePanel.querySelectorAll(".word-option").forEach((button) => {
    button.addEventListener("click", () => sendAction("choose-word", { word: button.dataset.word }));
  });
}

function renderControls(room) {
  const isHost = Boolean(room.me?.isHost);
  const startAllowedPhase = room.phase === "lobby" || room.phase === "finished";
  roundsSelect.disabled = !isHost || room.phase !== "lobby";
  startGameButton.disabled = !isHost || !startAllowedPhase || room.players.length < 2;

  const drawerActive = canDraw();
  clearBoardButton.disabled = !drawerActive;
  toolButtons.forEach((button) => {
    button.disabled = !drawerActive;
  });
  colorInput.disabled = !drawerActive || state.activeTool === "eraser";
  sizeInput.disabled = !drawerActive;

  const meIsDrawer = room.drawerId === room.me?.id;
  const alreadyGuessed = room.me?.hasGuessed;
  const canGuess = room.phase === "playing" && !meIsDrawer && !alreadyGuessed;
  guessInput.disabled = !canGuess;
  guessInput.placeholder = meIsDrawer
    ? "Você está desenhando"
    : alreadyGuessed
      ? "Você já acertou"
      : room.phase === "playing"
        ? "Digite seu palpite"
        : "Aguardando rodada";
  guessForm.querySelector("button").disabled = !canGuess;
  roomChatInput.disabled = !room.me;
  roomChatForm.querySelector("button").disabled = !room.me;
}

function renderOverlay(room) {
  const meIsDrawer = room.drawerId === room.me?.id;
  let text = "";

  if (room.phase === "lobby") {
    text = "Aguardando o host iniciar a partida";
  } else if (room.phase === "choosing") {
    text = meIsDrawer ? "Escolha uma palavra para começar" : `${room.drawerName} está escolhendo a palavra`;
  } else if (room.phase === "playing") {
    text = meIsDrawer ? "Sua vez de desenhar" : `Adivinhe o desenho de ${room.drawerName}`;
  } else if (room.phase === "roundEnd") {
    text = `Palavra: ${room.revealedWord || "-"}`;
  } else if (room.phase === "finished") {
    text = "Partida encerrada. Inicie outra no lobby.";
  }

  boardOverlay.textContent = text;
}

function renderChat(room) {
  const activeFeed = state.chatTab === "room" ? room.roomChat : room.roundChat;
  const emptyText = state.chatTab === "room" ? "Nenhuma mensagem na sala." : "Nenhum palpite ainda.";
  if (!activeFeed.length) {
    chatList.innerHTML = `<p class="empty-chat">${emptyText}</p>`;
    return;
  }

  chatList.innerHTML = activeFeed
    .map((item) => {
      const label =
        item.type === "system" ? "Sistema" : item.playerName || "Jogador";
      const className =
        item.type === "correct" ? "chat-item chat-item--correct" :
        item.type === "system" ? "chat-item chat-item--system" :
        item.type === "room" ? "chat-item chat-item--room" :
        "chat-item";

      return `
        <article class="${className}">
          <strong>${escapeHtml(label)}</strong>
          <p>${escapeHtml(item.text)}</p>
        </article>
      `;
    })
    .join("");

  chatList.scrollTop = chatList.scrollHeight;
}

function startCountdown() {
  clearInterval(state.timerHandle);
  if (!state.room) {
    timerLabel.textContent = "00:00";
    return;
  }

  const tick = () => {
    timerLabel.textContent = formatTime(state.room.timeLeftMs || 0);
    if (state.room.timeLeftMs > 0) {
      state.room.timeLeftMs = Math.max(0, state.room.timeLeftMs - 250);
    }
  };

  tick();
  state.timerHandle = setInterval(tick, 250);
}

function renderBoardEmpty() {
  const width = Math.max(320, Math.floor(boardFrame.clientWidth || 320));
  const height = Math.max(320, Math.floor(boardFrame.clientHeight || 320));
  boardCanvas.width = width;
  boardCanvas.height = height;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
}

function renderBoard() {
  const rect = boardFrame.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(320, Math.floor(rect.height));
  const ratio = window.devicePixelRatio || 1;

  boardCanvas.width = Math.floor(width * ratio);
  boardCanvas.height = Math.floor(height * ratio);
  boardCanvas.style.width = `${width}px`;
  boardCanvas.style.height = `${height}px`;

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  if (!state.room) {
    return;
  }

  const strokes = [...state.room.strokes];
  if (state.room.liveStroke) {
    strokes.push(state.room.liveStroke);
  }

  strokes.forEach((stroke) => drawStroke(stroke, width, height));
}

function drawStroke(stroke, width, height) {
  if (!stroke) {
    return;
  }

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = stroke.color || "#111111";
  ctx.lineWidth = Number(stroke.size) || 4;

  if (stroke.tool === "pen" || stroke.tool === "eraser") {
    const points = stroke.points || [];
    if (!points.length) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(points[0].x * width, points[0].y * height);
    for (const point of points.slice(1)) {
      ctx.lineTo(point.x * width, point.y * height);
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  const from = stroke.from || { x: 0, y: 0 };
  const to = stroke.to || from;
  const x1 = from.x * width;
  const y1 = from.y * height;
  const x2 = to.x * width;
  const y2 = to.y * height;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const shapeWidth = Math.abs(x2 - x1);
  const shapeHeight = Math.abs(y2 - y1);

  if (stroke.tool === "line") {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (stroke.tool === "rect") {
    ctx.strokeRect(left, top, shapeWidth, shapeHeight);
    ctx.restore();
    return;
  }

  if (stroke.tool === "circle") {
    ctx.beginPath();
    ctx.ellipse(
      left + shapeWidth / 2,
      top + shapeHeight / 2,
      Math.max(shapeWidth / 2, 2),
      Math.max(shapeHeight / 2, 2),
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    ctx.restore();
    return;
  }

  const points =
    stroke.tool === "triangle"
      ? trianglePoints(left, top, shapeWidth, shapeHeight)
      : starPoints(left, top, shapeWidth, shapeHeight);

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function trianglePoints(left, top, width, height) {
  return [
    { x: left + width / 2, y: top },
    { x: left + width, y: top + height },
    { x: left, y: top + height },
  ];
}

function starPoints(left, top, width, height) {
  const cx = left + width / 2;
  const cy = top + height / 2;
  const outer = Math.max(Math.min(width, height) / 2, 4);
  const inner = outer * 0.45;
  const points = [];

  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (Math.PI / 5) * index;
    points.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  return points;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function restoreSession() {
  if (!session.playerId) {
    return;
  }

  try {
    const payload = await api(`/api/state?playerId=${encodeURIComponent(session.playerId)}`);
    setRoom(payload.room);
    openEvents();
  } catch {
    resetSession();
  }
}
