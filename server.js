const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const MAX_PLAYERS = 5;
const ROUND_DURATION_MS = 12 * 60_000;
const CHOOSE_DURATION_MS = 15_000;
const TURN_GAP_MS = 4_000;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const WORD_BANK = [
  "abacaxi", "aviao", "balao", "banana", "bicicleta", "borboleta", "cachorro", "cadeira",
  "cafe", "caminhao", "castelo", "chuva", "computador", "coracao", "dinossauro", "elefante",
  "escada", "espelho", "estrela", "foguete", "gato", "guitarra", "hamburguer", "helicoptero",
  "ilha", "janela", "lampada", "livro", "lua", "martelo", "microfone", "montanha",
  "navio", "oculos", "palhaco", "panela", "peixe", "piano", "pirata", "pizza",
  "ponte", "rainha", "relampago", "sanduiche", "sapato", "sorvete", "tartaruga", "telefone",
  "trator", "trem", "violao", "xadrez", "zebra"
];

const rooms = new Map();
const playerToRoom = new Map();
const eventStreams = new Map();

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeWord(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase();
}

function cleanName(value, fallback) {
  const name = String(value || "").trim().slice(0, 24);
  return name || fallback;
}

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function shuffle(values) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function pickWordOptions() {
  return shuffle(WORD_BANK).slice(0, 3);
}

function getRoomByPlayer(playerId) {
  const roomCode = playerToRoom.get(playerId);
  return roomCode ? rooms.get(roomCode) : null;
}

function getPlayer(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function pushFeedEntry(feed, entry, limit = 80) {
  feed.push(entry);
  if (feed.length > limit) {
    feed.splice(0, feed.length - limit);
  }
}

function systemMessage(room, text) {
  pushFeedEntry(room.roomChat, {
    id: randomId("msg"),
    type: "system",
    text,
    createdAt: Date.now(),
  });
}

function roundMessage(room, entry) {
  pushFeedEntry(room.roundChat, {
    id: randomId("msg"),
    createdAt: Date.now(),
    ...entry,
  }, 60);
}

function computeGuessPoints(room) {
  const elapsedMs = room.startedAt ? Date.now() - room.startedAt : ROUND_DURATION_MS;
  const elapsedMinutes = elapsedMs / 60_000;

  if (elapsedMinutes <= 1) {
    return 10;
  }
  if (elapsedMinutes <= 5) {
    return 3;
  }
  if (elapsedMinutes <= 10) {
    return 2;
  }
  return 1;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function getDrawer(room) {
  return room.players.find((player) => player.id === room.drawerId) || null;
}

function maskWord(word) {
  return String(word || "")
    .split("")
    .map((char) => (char === " " ? " " : "_"))
    .join(" ");
}

function serializeRoom(room, viewerId) {
  const me = getPlayer(room, viewerId);
  const drawer = getDrawer(room);
  const now = Date.now();
  const timeLeftMs = room.deadlineAt ? Math.max(0, room.deadlineAt - now) : 0;
  const guessedIds = new Set(room.guessedPlayerIds);

  return {
    roomCode: room.code,
    phase: room.phase,
    rounds: room.rounds,
    roundNumber: room.roundNumber,
    turnNumber: room.turnNumber,
    me: me
      ? {
          id: me.id,
          name: me.name,
          isHost: me.isHost,
          score: me.score,
          hasGuessed: guessedIds.has(me.id),
        }
      : null,
    drawerId: room.drawerId,
    drawerName: drawer ? drawer.name : "",
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      isHost: player.isHost,
      connected: player.connected,
      hasGuessed: guessedIds.has(player.id),
      isDrawer: player.id === room.drawerId,
    })),
    strokes: room.strokes,
    liveStroke: room.liveStroke,
    roundChat: room.roundChat,
    roomChat: room.roomChat,
    timeLeftMs,
    maxPlayers: MAX_PLAYERS,
    wordHint: room.word && viewerId !== room.drawerId && room.phase === "playing" ? maskWord(room.word) : "",
    revealedWord: room.phase === "finished" || room.phase === "roundEnd" ? room.word || "" : "",
    chosenWord: viewerId === room.drawerId ? room.word || "" : "",
    wordOptions: viewerId === room.drawerId && room.phase === "choosing" ? room.wordOptions : [],
  };
}

function pushRoomState(room) {
  for (const player of room.players) {
    const listeners = eventStreams.get(player.id);
    if (!listeners || !listeners.size) {
      continue;
    }

    const payload = `data: ${JSON.stringify({ type: "room-state", room: serializeRoom(room, player.id) })}\n\n`;
    for (const res of listeners) {
      res.write(payload);
    }
  }
}

function endGame(room, message) {
  clearRoomTimer(room);
  room.phase = "finished";
  room.startedAt = null;
  room.deadlineAt = null;
  room.wordOptions = [];
  room.liveStroke = null;
  if (message) {
    systemMessage(room, message);
  }
  pushRoomState(room);
}

function scheduleNextTurn(room, reasonText) {
  clearRoomTimer(room);
  room.phase = "roundEnd";
  room.startedAt = null;
  room.deadlineAt = Date.now() + TURN_GAP_MS;
  room.liveStroke = null;
  if (reasonText) {
    systemMessage(room, reasonText);
  }
  pushRoomState(room);
  room.timer = setTimeout(() => beginTurn(room), TURN_GAP_MS);
}

function finishTurn(room, reason = "time") {
  if (!room || (room.phase !== "playing" && room.phase !== "choosing")) {
    return;
  }

  clearRoomTimer(room);

  const messages = {
    time: `Tempo encerrado. A palavra era "${room.word || "-"}".`,
    guessed: `A palavra foi descoberta. A palavra era "${room.word || "-"}".`,
    drawerLeft: `O desenhista saiu. A rodada foi encerrada.`,
  };

  scheduleNextTurn(room, messages[reason] || messages.time);
}

function startPlaying(room, chosenWord) {
  room.word = chosenWord;
  room.phase = "playing";
  room.startedAt = Date.now();
  room.deadlineAt = Date.now() + ROUND_DURATION_MS;
  room.roundChat = [];
  room.guessedPlayerIds = [];
  room.strokes = [];
  room.liveStroke = null;
  roundMessage(room, {
    type: "system",
    text: `${getDrawer(room)?.name || "Desenhista"} começou a desenhar.`,
  });
  systemMessage(room, `${getDrawer(room)?.name || "Desenhista"} começou a desenhar.`);
  pushRoomState(room);
  clearRoomTimer(room);
  room.timer = setTimeout(() => finishTurn(room, "time"), ROUND_DURATION_MS);
}

function beginTurn(room) {
  clearRoomTimer(room);

  if (room.players.length < 2) {
    room.phase = "lobby";
    room.drawerId = null;
    room.startedAt = null;
    room.deadlineAt = null;
    room.word = "";
    room.wordOptions = [];
    room.strokes = [];
    room.liveStroke = null;
    systemMessage(room, "Aguardando pelo menos 2 jogadores.");
    pushRoomState(room);
    return;
  }

  const totalTurns = room.rounds * room.players.length;
  if (room.turnNumber >= totalTurns) {
    endGame(room, "Partida encerrada.");
    return;
  }

  const drawerIndex = room.turnNumber % room.players.length;
  room.roundNumber = Math.floor(room.turnNumber / room.players.length) + 1;
  room.drawerId = room.players[drawerIndex].id;
  room.turnNumber += 1;
  room.phase = "choosing";
  room.word = "";
  room.wordOptions = pickWordOptions();
  room.startedAt = null;
  room.deadlineAt = Date.now() + CHOOSE_DURATION_MS;
  room.strokes = [];
  room.liveStroke = null;
  room.guessedPlayerIds = [];
  room.roundChat = [];
  systemMessage(room, `Rodada ${room.roundNumber}: ${room.players[drawerIndex].name} escolhe a palavra.`);
  pushRoomState(room);

  room.timer = setTimeout(() => {
    startPlaying(room, room.wordOptions[0]);
  }, CHOOSE_DURATION_MS);
}

function createRoom(playerName) {
  const roomCode = makeRoomCode();
  const playerId = randomId("player");
  const room = {
    code: roomCode,
    phase: "lobby",
    rounds: 3,
    roundNumber: 0,
    turnNumber: 0,
    drawerId: null,
    word: "",
    wordOptions: [],
    deadlineAt: null,
    strokes: [],
    liveStroke: null,
    guessedPlayerIds: [],
    roundChat: [],
    roomChat: [],
    timer: null,
    players: [
      {
        id: playerId,
        name: cleanName(playerName, "Host"),
        score: 0,
        isHost: true,
        connected: true,
      },
    ],
  };

  rooms.set(roomCode, room);
  playerToRoom.set(playerId, roomCode);
  systemMessage(room, `${room.players[0].name} criou a sala.`);
  return { room, playerId };
}

function joinRoom(roomCode, playerName) {
  const room = rooms.get(String(roomCode || "").trim().toUpperCase());
  if (!room) {
    throw new Error("Sala não encontrada.");
  }
  if (room.players.length >= MAX_PLAYERS) {
    throw new Error("A sala já está cheia.");
  }

  const playerId = randomId("player");
  const player = {
    id: playerId,
    name: cleanName(playerName, `Jogador ${room.players.length + 1}`),
    score: 0,
    isHost: false,
    connected: true,
  };

  room.players.push(player);
  playerToRoom.set(playerId, room.code);
  systemMessage(room, `${player.name} entrou na sala.`);
  pushRoomState(room);
  return { room, playerId };
}

function closeRoomIfEmpty(room) {
  if (room.players.length === 0) {
    clearRoomTimer(room);
    rooms.delete(room.code);
  }
}

function leaveRoom(playerId) {
  const room = getRoomByPlayer(playerId);
  if (!room) {
    return;
  }

  const player = getPlayer(room, playerId);
  room.players = room.players.filter((item) => item.id !== playerId);
  room.guessedPlayerIds = room.guessedPlayerIds.filter((id) => id !== playerId);
  playerToRoom.delete(playerId);
  eventStreams.delete(playerId);

  if (player?.isHost && room.players[0]) {
    room.players[0].isHost = true;
  }

  if (player) {
    systemMessage(room, `${player.name} saiu da sala.`);
  }

  if (room.drawerId === playerId) {
    room.drawerId = null;
    if (room.players.length >= 2 && (room.phase === "playing" || room.phase === "choosing")) {
      finishTurn(room, "drawerLeft");
      return;
    }
  }

  if (room.players.length < 2 && room.phase !== "lobby" && room.phase !== "finished") {
    clearRoomTimer(room);
    room.phase = "lobby";
    room.turnNumber = 0;
    room.roundNumber = 0;
    room.word = "";
    room.wordOptions = [];
    room.startedAt = null;
    room.deadlineAt = null;
    room.strokes = [];
    room.liveStroke = null;
    systemMessage(room, "Partida interrompida por falta de jogadores.");
  }

  closeRoomIfEmpty(room);
  if (rooms.has(room.code)) {
    pushRoomState(room);
  }
}

function validateDrawerAction(room, playerId) {
  if (room.drawerId !== playerId || room.phase !== "playing") {
    throw new Error("Apenas o desenhista pode usar a lousa agora.");
  }
}

function clampPoint(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function sanitizeStrokeBase(payload) {
  return {
    id: String(payload.id || randomId("stroke")),
    tool: String(payload.tool || "pen"),
    color: String(payload.color || "#111111").slice(0, 12),
    size: Math.max(2, Math.min(48, Number(payload.size) || 4)),
  };
}

function handleAction(playerId, type, payload) {
  const room = getRoomByPlayer(playerId);
  if (!room) {
    throw new Error("Jogador sem sala ativa.");
  }

  const player = getPlayer(room, playerId);
  if (!player) {
    throw new Error("Jogador não encontrado.");
  }

  if (type === "set-rounds") {
    if (!player.isHost || room.phase !== "lobby") {
      throw new Error("Só o host pode ajustar as rodadas no lobby.");
    }
    room.rounds = Math.max(1, Math.min(5, Number(payload.rounds) || 3));
    pushRoomState(room);
    return;
  }

  if (type === "start-game") {
    if (!player.isHost) {
      throw new Error("Só o host pode iniciar.");
    }
    if (room.players.length < 2) {
      throw new Error("São necessários pelo menos 2 jogadores.");
    }
    room.players.forEach((item) => {
      item.score = 0;
    });
    room.turnNumber = 0;
    room.roundNumber = 0;
    room.roundChat = [];
    room.strokes = [];
    room.liveStroke = null;
    systemMessage(room, `${player.name} iniciou uma nova partida.`);
    beginTurn(room);
    return;
  }

  if (type === "choose-word") {
    if (room.drawerId !== playerId || room.phase !== "choosing") {
      throw new Error("Só o desenhista escolhe a palavra.");
    }
    const word = room.wordOptions.find((option) => option === String(payload.word || ""));
    if (!word) {
      throw new Error("Palavra inválida.");
    }
    startPlaying(room, word);
    return;
  }

  if (type === "guess") {
    if (room.phase !== "playing") {
      throw new Error("A rodada não está aceitando palpites.");
    }
    if (playerId === room.drawerId) {
      throw new Error("O desenhista não pode palpitar.");
    }
    if (room.guessedPlayerIds.includes(playerId)) {
      return;
    }

    const guessText = String(payload.text || "").trim().slice(0, 60);
    if (!guessText) {
      return;
    }

    const isCorrect = normalizeWord(guessText) === normalizeWord(room.word);
    if (isCorrect) {
      const awardedPoints = computeGuessPoints(room);
      room.guessedPlayerIds.push(playerId);
      player.score += awardedPoints;
      roundMessage(room, {
        type: "correct",
        playerId,
        playerName: player.name,
        text: "acertou!",
      });
      systemMessage(room, `${player.name} acertou a palavra e marcou ${awardedPoints} pontos.`);
      pushRoomState(room);
      finishTurn(room, "guessed");
      return;
    }

    roundMessage(room, {
      type: "guess",
      playerId,
      playerName: player.name,
      text: guessText,
    });
    pushRoomState(room);
    return;
  }

  if (type === "room-message") {
    const text = String(payload.text || "").trim().slice(0, 220);
    if (!text) {
      return;
    }
    pushFeedEntry(room.roomChat, {
      id: randomId("msg"),
      type: "room",
      playerId,
      playerName: player.name,
      text,
      createdAt: Date.now(),
    }, 100);
    pushRoomState(room);
    return;
  }

  if (type === "clear-board") {
    validateDrawerAction(room, playerId);
    room.strokes = [];
    room.liveStroke = null;
    pushRoomState(room);
    return;
  }

  if (type === "begin-stroke") {
    validateDrawerAction(room, playerId);
    const stroke = sanitizeStrokeBase(payload);
    const point = { x: clampPoint(payload.x), y: clampPoint(payload.y) };

    if (stroke.tool === "pen" || stroke.tool === "eraser") {
      stroke.points = [point];
    } else {
      stroke.from = point;
      stroke.to = point;
    }

    room.liveStroke = stroke;
    pushRoomState(room);
    return;
  }

  if (type === "extend-stroke") {
    validateDrawerAction(room, playerId);
    if (!room.liveStroke) {
      return;
    }
    const point = { x: clampPoint(payload.x), y: clampPoint(payload.y) };
    if (room.liveStroke.tool === "pen" || room.liveStroke.tool === "eraser") {
      room.liveStroke.points.push(point);
    } else {
      room.liveStroke.to = point;
    }
    pushRoomState(room);
    return;
  }

  if (type === "end-stroke") {
    validateDrawerAction(room, playerId);
    if (!room.liveStroke) {
      return;
    }
    const point = { x: clampPoint(payload.x), y: clampPoint(payload.y) };
    if (room.liveStroke.tool === "pen" || room.liveStroke.tool === "eraser") {
      room.liveStroke.points.push(point);
    } else {
      room.liveStroke.to = point;
    }
    room.strokes.push(room.liveStroke);
    room.liveStroke = null;
    if (room.strokes.length > 500) {
      room.strokes = room.strokes.slice(-500);
    }
    pushRoomState(room);
    return;
  }

  throw new Error("Ação inválida.");
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === "POST" && pathname === "/api/rooms/create") {
    const body = await readBody(req);
    const { room, playerId } = createRoom(body.playerName);
    sendJson(res, 200, {
      playerId,
      room: serializeRoom(room, playerId),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/join") {
    const body = await readBody(req);
    const { room, playerId } = joinRoom(body.roomCode, body.playerName);
    sendJson(res, 200, {
      playerId,
      room: serializeRoom(room, playerId),
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/rooms/leave") {
    const body = await readBody(req);
    leaveRoom(String(body.playerId || ""));
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/state") {
    const playerId = String(url.searchParams.get("playerId") || "");
    const room = getRoomByPlayer(playerId);
    if (!room) {
      sendJson(res, 404, { error: "Sala não encontrada." });
      return true;
    }
    sendJson(res, 200, { room: serializeRoom(room, playerId) });
    return true;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    const playerId = String(url.searchParams.get("playerId") || "");
    const room = getRoomByPlayer(playerId);
    if (!room) {
      sendJson(res, 404, { error: "Sala não encontrada." });
      return true;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });

    res.write(`data: ${JSON.stringify({ type: "room-state", room: serializeRoom(room, playerId) })}\n\n`);

    if (!eventStreams.has(playerId)) {
      eventStreams.set(playerId, new Set());
    }
    eventStreams.get(playerId).add(res);

    const player = getPlayer(room, playerId);
    if (player && !player.connected) {
      player.connected = true;
      pushRoomState(room);
    }

    req.on("close", () => {
      const streams = eventStreams.get(playerId);
      if (streams) {
        streams.delete(res);
        if (!streams.size) {
          eventStreams.delete(playerId);
          const activeRoom = getRoomByPlayer(playerId);
          const activePlayer = activeRoom ? getPlayer(activeRoom, playerId) : null;
          if (activePlayer) {
            activePlayer.connected = false;
            pushRoomState(activeRoom);
          }
        }
      }
    });
    return true;
  }

  if (req.method === "POST" && pathname === "/api/action") {
    const body = await readBody(req);
    handleAction(String(body.playerId || ""), String(body.type || ""), body.payload || {});
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (!handled) {
        sendJson(res, 404, { error: "Rota não encontrada." });
      }
      return;
    }

    const relativePath = url.pathname === "/" ? "/index.html" : url.pathname;
    const safePath = path.normalize(decodeURIComponent(relativePath)).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(ROOT, safePath);

    if (!filePath.startsWith(ROOT)) {
      send(res, 403, "Forbidden");
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        if (error.code === "ENOENT") {
          send(res, 404, "Not found");
          return;
        }
        send(res, 500, "Server error");
        return;
      }

      send(res, 200, data, MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
    });
  } catch (error) {
    sendJson(res, 500, { error: "Erro interno.", details: String(error.message || error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Draw Battle: http://${HOST}:${PORT}/`);
});
