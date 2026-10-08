const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
const LEVELS = [
  {
    id: "01",
    name: "First Light",
    seconds: 60,
    map: [
      "#############",
      "#S1.#.#....X#",
      "###.#.#.###.#",
      "#....2......#",
      "#.###.#.###.#",
      "#..3..#..4..#",
      "#.#.#.#.#.#.#",
      "#........5..#",
      "#############",
    ],
  },
  {
    id: "02",
    name: "Crossed Signals",
    seconds: 68,
    map: [
      "###############",
      "#S#.....#4....#",
      "#.###.#.#.###.#",
      "#...#.#2#.#5..#",
      "###.#.#.#.#.###",
      "#.#..1#.#.#...#",
      "#.#####.#.###.#",
      "#.....#.#.#.#.#",
      "#.#####.#.#.#.#",
      "#........3#..X#",
      "###############",
    ],
  },
  {
    id: "03",
    name: "Liquidity Run",
    seconds: 76,
    map: [
      "#################",
      "#S......#.......#",
      "#######.#.#####2#",
      "#.....#.1.#...#.#",
      "#.###.#####.###.#",
      "#...#...#3......#",
      "#.#####.#.#######",
      "#.#.....#.#...#.#",
      "###.#####.#5#.#.#",
      "#...#.....#.#.#.#",
      "#.###4#####.#.#.#",
      "#...........#..X#",
      "#################",
    ],
  },
  {
    id: "04",
    name: "Closing Bell",
    seconds: 84,
    map: [
      "###################",
      "#S....#.....#...#.#",
      "#####.#2###.#.#.#.#",
      "#...#.#...#..3#.#.#",
      "###.#.###.#####.#.#",
      "#...#.1...#...#.4.#",
      "#.#.#######.#.###.#",
      "#.#...#.....#...#.#",
      "#.###.#.#####.###.#",
      "#...#...#.....#...#",
      "#.#.#####.#####5###",
      "#.#.....#...#...#.#",
      "#.#####.#####.###.#",
      "#.....#..........X#",
      "###################",
    ],
  },
];
let LEVEL = LEVELS[0].map;
let GRID_WIDTH = LEVEL[0].length;
let GRID_HEIGHT = LEVEL.length;
const PICKUP_COUNT = 5;
const POINTS_PER_PICKUP = 100;
const PLAYER_RADIUS = 0.19;
const MOVE_SPEED = 3.35;
const STORAGE_KEY = "merkle-stock-gap-maze-records-v2";

const elements = {
  stage: document.querySelector("#game-stage"),
  canvas: document.querySelector("#game-canvas"),
  loading: document.querySelector("#game-loading"),
  overlay: document.querySelector("#game-overlay"),
  welcome: document.querySelector("#welcome-panel"),
  result: document.querySelector("#result-panel"),
  start: document.querySelector("#start-game"),
  retry: document.querySelector("#retry-game"),
  countdown: document.querySelector("#game-countdown"),
  error: document.querySelector("#game-error"),
  score: document.querySelector("#score-value"),
  found: document.querySelector("#found-value"),
  time: document.querySelector("#time-value"),
  best: document.querySelector("#best-value"),
  tickerList: document.querySelector("#ticker-list"),
  tickerStatus: document.querySelector("#ticker-status"),
  scoreDot: document.querySelector("#score-live-dot"),
  resultKicker: document.querySelector("#result-kicker"),
  resultTitle: document.querySelector("#result-title"),
  resultCopy: document.querySelector("#result-copy"),
  welcomeKicker: document.querySelector("#welcome-kicker"),
  welcomeCopy: document.querySelector("#welcome-copy"),
  runMode: document.querySelector("#run-mode"),
  levelSelect: document.querySelector("#level-select"),
  levelNote: document.querySelector("#level-note"),
  stageLevel: document.querySelector("#stage-level"),
  stageGrid: document.querySelector("#stage-grid"),
  layout: document.querySelector(".game-layout"),
  share: document.querySelector("#share-scorecard"),
  downloadScorecard: document.querySelector("#download-scorecard"),
  shareStatus: document.querySelector("#share-status"),
  leaderboard: document.querySelector("#leaderboard-body"),
  mobileControls: document.querySelector("#mobile-controls"),
};

const input = {
  keys: new Set(),
  touch: null,
};

const game = {
  THREE: null,
  renderer: null,
  scene: null,
  camera: null,
  player: null,
  playerPosition: null,
  pickups: [],
  assets: [],
  exitPosition: null,
  state: "loading",
  levelIndex: 0,
  runMode: "campaign",
  records: null,
  campaignSeconds: 0,
  campaignScore: 0,
  pendingNextLevel: false,
  completedRun: null,
  audioContext: null,
  score: 0,
  collected: 0,
  startedAt: 0,
  remaining: LEVELS[0].seconds,
  lastFrame: 0,
  animationFrame: 0,
  resizeObserver: null,
};

function cellCenter(column, row) {
  return {
    x: column + 0.5 - GRID_WIDTH / 2,
    z: row + 0.5 - GRID_HEIGHT / 2,
  };
}

function locateCell(symbol) {
  for (let row = 0; row < GRID_HEIGHT; row += 1) {
    const column = LEVEL[row].indexOf(symbol);
    if (column !== -1) return { column, row };
  }
  return null;
}

function setStatus(message) {
  if (elements.tickerStatus.textContent !== message) elements.tickerStatus.textContent = message;
}

function setVisible(element, visible) {
  element.hidden = !visible;
}

function formatClock(seconds) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function emptyRecords() {
  return { unlockedLevel: 0, levels: LEVELS.map(() => null), campaign: null };
}

function readRecords() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object") return emptyRecords();
    const unlockedLevel = Number.isInteger(stored.unlockedLevel)
      ? Math.min(LEVELS.length - 1, Math.max(0, stored.unlockedLevel))
      : 0;
    const levels = LEVELS.map((level, index) => {
      const record = Array.isArray(stored.levels) ? stored.levels[index] : null;
      if (!record || !Number.isFinite(record.seconds) || !Number.isFinite(record.score)) return null;
      return { seconds: Math.max(0, Math.round(record.seconds)), score: Math.max(0, Math.round(record.score)) };
    });
    const campaign = stored.campaign && Number.isFinite(stored.campaign.seconds)
      ? { seconds: Math.max(0, Math.round(stored.campaign.seconds)), score: Math.max(0, Math.round(stored.campaign.score || 0)) }
      : null;
    return { unlockedLevel, levels, campaign };
  } catch {
    return emptyRecords();
  }
}

function saveRecords() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(game.records));
    return true;
  } catch {
    return false;
  }
}

function renderBestRun() {
  const best = game.records?.levels[game.levelIndex];
  elements.best.textContent = best ? formatClock(best.seconds) : "—";
}

function renderLeaderboard() {
  if (!elements.leaderboard || !game.records) return;
  elements.leaderboard.replaceChildren();
  LEVELS.forEach((level, index) => {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    name.textContent = `${level.id} · ${level.name}`;
    const time = document.createElement("td");
    const record = game.records.levels[index];
    time.textContent = record ? formatClock(record.seconds) : "—";
    const state = document.createElement("td");
    state.textContent = index <= game.records.unlockedLevel ? (record ? "CLEARED" : "OPEN") : "LOCKED";
    state.className = index > game.records.unlockedLevel ? "is-locked" : "";
    row.append(name, time, state);
    campaignRow.append(campaignName, campaignTime, campaignState);
    elements.leaderboard.append(campaignRow);
  }
  const campaignRow = document.createElement("tr");
  campaignRow.className = "campaign-record-row";
  const campaignName = document.createElement("th");
  campaignName.scope = "row";
  campaignName.textContent = "FULL CAMPAIGN";
  const campaignTime = document.createElement("td");
  campaignTime.textContent = game.records.campaign ? formatClock(game.records.campaign.seconds) : "—";
  const campaignState = document.createElement("td");
  campaignState.textContent = game.records.campaign ? "CLEARED" : "4 LEVELS";
  campaignRow.append(campaignName, campaignTime, campaignState);
  elements.leaderboard.append(campaignRow);
}

function updateLevelOptions() {
  elements.levelSelect.replaceChildren();
  LEVELS.forEach((level, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${level.id} · ${level.name}${index > game.records.unlockedLevel ? " · LOCKED" : ""}`;
    option.disabled = index > game.records.unlockedLevel;
    elements.levelSelect.append(option);
  });
  elements.levelSelect.value = String(Math.min(game.levelIndex, game.records.unlockedLevel));
}

function updateWelcomePanel() {
  game.runMode = elements.runMode.value;
  const campaign = game.runMode === "campaign";
  elements.levelSelect.disabled = campaign;
  const selectedIndex = campaign ? 0 : Number(elements.levelSelect.value);
  const level = LEVELS[selectedIndex] || LEVELS[0];
  if (game.THREE && game.state === "ready" && selectedIndex !== game.levelIndex) loadLevel(selectedIndex);
  elements.welcomeKicker.textContent = campaign
    ? `CAMPAIGN / ${LEVELS.length} LEVELS / 60–84 SEC EACH`
    : `LEVEL ${level.id} / ${level.seconds} SECONDS`;
  elements.welcomeCopy.textContent = campaign
    ? "Clear four increasingly intricate mazes in sequence. Collect all five tickers and reach each exit to set a campaign time."
    : `${level.name}: collect all five ticker cards, then reach the exit. Each pickup adds 100 points.`;
  elements.levelNote.textContent = campaign
    ? "Campaign begins at Level 01 and unlocks the next map after each clear."
    : `${level.map[0].length} × ${level.map.length} grid · ${level.seconds} seconds · ${game.records.levels[selectedIndex] ? `best ${formatClock(game.records.levels[selectedIndex].seconds)}` : "no clear yet"}`;
  elements.start.innerHTML = campaign
    ? 'Start campaign <span aria-hidden="true">→</span>'
    : `Start Level ${level.id} <span aria-hidden="true">→</span>`;
}

function showError(message) {
  elements.loading.hidden = true;
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.start.disabled = true;
  elements.start.textContent = "3D preview unavailable";
}

function createTickerLabel(THREE, ticker, company) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(7, 11, 9, 0.92)";
  context.strokeStyle = "rgba(184, 224, 190, 0.72)";
  context.lineWidth = 4;
  context.beginPath();
  context.roundRect(5, 5, 502, 150, 10);
  context.fill();
  context.stroke();
  context.fillStyle = "#e9f1e5";
  context.font = "600 58px SFMono-Regular, Menlo, monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(ticker.slice(0, 9), 256, 58);
  context.fillStyle = "#a8b8a7";
  context.font = "400 25px Arial, sans-serif";
  context.fillText(company.slice(0, 24), 256, 115);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.58, 0.5, 1);
  return sprite;
}

function addWorld(THREE) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090b0b);
  scene.fog = new THREE.Fog(0x090b0b, 18, 34);
  scene.add(new THREE.HemisphereLight(0xb7cbb9, 0x111516, 2.1));

  const keyLight = new THREE.DirectionalLight(0xe4ede0, 2.5);
  keyLight.position.set(-5, 13, 7);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x8cab98, 0.8);
  fillLight.position.set(8, 9, -10);
  scene.add(fillLight);

  const board = new THREE.Group();
  scene.add(board);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(GRID_WIDTH, GRID_HEIGHT),
    new THREE.MeshStandardMaterial({ color: 0x131918, roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.08;
  board.add(floor);

  const gridPoints = [];
  for (let column = 0; column <= GRID_WIDTH; column += 1) {
    const x = column - GRID_WIDTH / 2;
    gridPoints.push(new THREE.Vector3(x, -0.055, -GRID_HEIGHT / 2), new THREE.Vector3(x, -0.055, GRID_HEIGHT / 2));
  }
  for (let row = 0; row <= GRID_HEIGHT; row += 1) {
    const z = row - GRID_HEIGHT / 2;
    gridPoints.push(new THREE.Vector3(-GRID_WIDTH / 2, -0.055, z), new THREE.Vector3(GRID_WIDTH / 2, -0.055, z));
  }
  const gridGeometry = new THREE.BufferGeometry().setFromPoints(gridPoints);
  board.add(new THREE.LineSegments(gridGeometry, new THREE.LineBasicMaterial({ color: 0x2a3732, transparent: true, opacity: 0.7 })));

  const wallCells = [];
  LEVEL.forEach((line, row) => {
    [...line].forEach((cell, column) => {
      if (cell === "#") wallCells.push({ column, row });
    });
  });

  const wallGeometry = new THREE.BoxGeometry(0.94, 1.12, 0.94);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x29312d, roughness: 0.78, metalness: 0.12, vertexColors: true });
  const walls = new THREE.InstancedMesh(wallGeometry, wallMaterial, wallCells.length);
  const wallTransform = new THREE.Object3D();
  const wallColor = new THREE.Color();
  wallCells.forEach(({ column, row }, index) => {
    const position = cellCenter(column, row);
    wallTransform.position.set(position.x, 0.52, position.z);
    wallTransform.updateMatrix();
    walls.setMatrixAt(index, wallTransform.matrix);
    const tint = 0.87 + ((column * 7 + row * 3) % 5) * 0.045;
    wallColor.setRGB(0.16 * tint, 0.2 * tint, 0.18 * tint);
    walls.setColorAt(index, wallColor);
  });
  walls.instanceMatrix.needsUpdate = true;
  if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
  board.add(walls);

  const exitCell = locateCell("X");
  game.exitPosition = cellCenter(exitCell.column, exitCell.row);
  const exitGroup = new THREE.Group();
  const exitBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.055, 32),
    new THREE.MeshStandardMaterial({ color: 0x294b37, emissive: 0x183321, roughness: 0.5 }),
  );
  exitBase.position.y = 0.015;
  exitGroup.add(exitBase);
  const exitRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.045, 8, 32),
    new THREE.MeshStandardMaterial({ color: 0xa7d9b4, emissive: 0x42634c, roughness: 0.42 }),
  );
  exitRing.rotation.x = Math.PI / 2;
  exitRing.position.y = 0.08;
  exitGroup.add(exitRing);
  exitGroup.position.set(game.exitPosition.x, 0, game.exitPosition.z);
  board.add(exitGroup);
  game.exitObject = exitRing;

  const pickupGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.075, 32);
  const pickupMaterial = new THREE.MeshStandardMaterial({ color: 0xa7d9b4, emissive: 0x233d2a, metalness: 0.48, roughness: 0.34 });
  const pickupEdgeMaterial = new THREE.MeshStandardMaterial({ color: 0xe3f0db, emissive: 0x243a2a, metalness: 0.35, roughness: 0.28 });
  game.pickups = [];
  for (let index = 1; index <= PICKUP_COUNT; index += 1) {
    const cell = locateCell(String(index));
    const position = cellCenter(cell.column, cell.row);
    const group = new THREE.Group();
    const coin = new THREE.Mesh(pickupGeometry, pickupMaterial);
    coin.rotation.x = Math.PI / 2;
    coin.position.y = 0.62;
    group.add(coin);
    const edge = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 28), pickupEdgeMaterial);
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.63;
    group.add(edge);
    const asset = game.assets[index - 1];
    const label = createTickerLabel(THREE, asset.ticker, asset.company);
    label.position.y = 1.32;
    group.add(label);
    group.position.set(position.x, 0, position.z);
    board.add(group);
    game.pickups.push({ group, coin, position, asset, collected: false, phase: index * 0.9 });
  }

  const startCell = locateCell("S");
  game.playerPosition = cellCenter(startCell.column, startCell.row);
  game.player = new THREE.Group();
  const playerBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.27, 0.3, 0.14, 24),
    new THREE.MeshStandardMaterial({ color: 0xdce9d7, emissive: 0x314c38, metalness: 0.18, roughness: 0.4 }),
  );
  playerBase.position.y = 0.12;
  game.player.add(playerBase);
  const playerBody = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 20, 14),
    new THREE.MeshStandardMaterial({ color: 0xa7d9b4, emissive: 0x2a4733, roughness: 0.36 }),
  );
  playerBody.scale.y = 1.28;
  playerBody.position.y = 0.42;
  game.player.add(playerBody);
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x102117 }),
  );
  marker.position.set(0, 0.45, -0.2);
  game.player.add(marker);
  game.player.position.set(game.playerPosition.x, 0, game.playerPosition.z);
  board.add(game.player);

  const cameraTarget = new THREE.Vector3(0, 0, 0);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 80);
  camera.position.set(8.5, 18, 10.5);
  camera.lookAt(cameraTarget);
  game.scene = scene;
  game.camera = camera;
  game.board = board;
  return { scene, camera };
}

function populateTickerBoard() {
  elements.tickerList.replaceChildren();
  game.assets.forEach((asset, index) => {
    const item = document.createElement("li");
    item.dataset.pickupIndex = String(index);
    const number = document.createElement("span");
    number.className = "ticker-index";
    number.textContent = String(index + 1).padStart(2, "0");
    const copy = document.createElement("span");
    copy.className = "ticker-copy";
    const symbol = document.createElement("strong");
    symbol.className = "ticker-symbol";
    symbol.textContent = asset.ticker;
    const company = document.createElement("span");
    company.className = "ticker-company";
    company.textContent = asset.company;
    const points = document.createElement("span");
    points.className = "ticker-points";
    points.textContent = `+${POINTS_PER_PICKUP}`;
    copy.append(symbol, company);
    item.append(number, copy, points);
    elements.tickerList.append(item);
  });
  setStatus("5 ASSETS READY");
}

async function loadAssets() {
  const response = await fetch("./data/markets.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Could not load the monitor's ticker registry.");
  const snapshot = await response.json();
  if (!Array.isArray(snapshot.markets)) throw new Error("The ticker registry is missing its market list.");
  const seen = new Set();
  const assets = snapshot.markets.filter((market) => {
    const ticker = typeof market.ticker === "string" ? market.ticker.trim() : "";
    const company = typeof market.company === "string" ? market.company.trim() : "";
    if (!ticker || !company || seen.has(ticker.toUpperCase())) return false;
    seen.add(ticker.toUpperCase());
    return true;
  }).slice(0, PICKUP_COUNT).map((market) => ({
    ticker: market.ticker.trim().toUpperCase(),
    company: market.company.trim(),
  }));
  if (assets.length < PICKUP_COUNT) throw new Error("The monitor needs five ticker entries before the maze can start.");
  game.assets = assets;
  populateTickerBoard();
}

function resizeRenderer() {
  if (!game.renderer || !game.camera) return;
  const width = Math.max(1, elements.stage.clientWidth);
  const height = Math.max(1, elements.stage.clientHeight);
  const aspect = width / height;
  const projectedWidth = GRID_WIDTH + GRID_HEIGHT * 0.4;
  const projectedHeight = GRID_HEIGHT + GRID_WIDTH * 0.35;
  const viewHeight = Math.max(16.6, projectedHeight, projectedWidth / aspect);
  const viewWidth = viewHeight * aspect;
  game.camera.left = -viewWidth / 2;
  game.camera.right = viewWidth / 2;
  game.camera.top = viewHeight / 2;
  game.camera.bottom = -viewHeight / 2;
  game.camera.updateProjectionMatrix();
  game.renderer.setSize(width, height, false);
}

function setScore() {
  elements.score.textContent = String(game.score).padStart(3, "0");
  elements.found.textContent = `${String(game.collected).padStart(2, "0")} / 05`;
  elements.scoreDot.classList.toggle("is-active", game.collected > 0);
}

function disposeScene(scene) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => {
      materials.add(material);
      Object.values(material).filter((value) => value?.isTexture).forEach((texture) => textures.add(texture));
    });
  });
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
}

function loadLevel(index) {
  const safeIndex = Math.max(0, Math.min(LEVELS.length - 1, index));
  if (game.scene) disposeScene(game.scene);
  game.levelIndex = safeIndex;
  LEVEL = LEVELS[safeIndex].map;
  GRID_WIDTH = LEVEL[0].length;
  GRID_HEIGHT = LEVEL.length;
  game.pickups = [];
  game.THREE && addWorld(game.THREE);
  elements.stageLevel.textContent = `LEVEL ${LEVELS[safeIndex].id}`;
  elements.stageGrid.textContent = `${GRID_WIDTH} × ${GRID_HEIGHT} GRID`;
  elements.layout.setAttribute("aria-label", `Stock Gap Maze level ${LEVELS[safeIndex].id}: ${LEVELS[safeIndex].name}`);
  game.lastFrame = 0;
  resetRun();
  if (game.renderer) resizeRenderer();
}

function resetRun() {
  game.score = 0;
  game.collected = 0;
  game.remaining = LEVELS[game.levelIndex].seconds;
  game.startedAt = 0;
  game.state = "ready";
  game.pendingNextLevel = false;
  game.completedRun = null;
  input.keys.clear();
  input.touch = null;
  for (const pickup of game.pickups) {
    pickup.collected = false;
    pickup.group.visible = true;
  }
  const startCell = locateCell("S");
  game.playerPosition = cellCenter(startCell.column, startCell.row);
  if (game.player) game.player.position.set(game.playerPosition.x, 0, game.playerPosition.z);
  setScore();
  elements.time.textContent = formatClock(game.remaining);
  elements.time.classList.remove("is-urgent");
  elements.shareStatus.textContent = "";
  elements.tickerList.querySelectorAll(".is-collected").forEach((item) => item.classList.remove("is-collected"));
  setStatus("5 ASSETS READY");
  renderBestRun();
  setOverlayMode("ready");
}

function setOverlayMode(mode) {
  setVisible(elements.overlay, mode !== "countdown" && mode !== "playing");
  setVisible(elements.welcome, mode === "ready");
  setVisible(elements.result, mode === "complete" || mode === "timeout");
  elements.mobileControls.querySelectorAll("button").forEach((button) => {
    button.disabled = mode !== "playing";
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function unlockAudio() {
  try {
    const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextConstructor) return;
    game.audioContext ??= new AudioContextConstructor();
    if (game.audioContext.state === "suspended") game.audioContext.resume().catch(() => {});
  } catch {
    game.audioContext = null;
  }
}

function playPickupChime() {
  const context = game.audioContext;
  if (!context || context.state !== "running") return;
  try {
    const now = context.currentTime;
    [659.25, 987.77].forEach((frequency, index) => {
      const startAt = now + index * 0.045;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.055, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.2);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.21);
    });
  } catch {
    return;
  }
}

async function startRun() {
  if (game.state !== "ready") return;
  game.state = "countdown";
  setOverlayMode("countdown");
  input.keys.clear();
  setVisible(elements.countdown, true);
  for (const label of ["3", "2", "1", "RUN"]) {
    elements.countdown.textContent = label;
    await delay(label === "RUN" ? 360 : 650);
  }
  setVisible(elements.countdown, false);
  game.state = "playing";
  game.startedAt = performance.now();
  game.remaining = LEVELS[game.levelIndex].seconds;
  setOverlayMode("playing");
  elements.canvas.focus({ preventScroll: true });
}

function startSelectedRun() {
  if (game.state !== "ready") return;
  unlockAudio();
  game.runMode = elements.runMode.value;
  game.campaignSeconds = 0;
  game.campaignScore = 0;
  const selectedLevel = game.runMode === "campaign" ? 0 : Number(elements.levelSelect.value);
  if (selectedLevel !== game.levelIndex) loadLevel(selectedLevel);
  resetRun();
  startRun();
}

function updateLevelRecord(elapsed) {
  const previous = game.records.levels[game.levelIndex];
  if (!previous || elapsed < previous.seconds || (elapsed === previous.seconds && game.score > previous.score)) {
    game.records.levels[game.levelIndex] = { seconds: elapsed, score: game.score };
  }
  game.records.unlockedLevel = Math.max(
    game.records.unlockedLevel,
    Math.min(LEVELS.length - 1, game.levelIndex + 1),
  );
}

function finishRun(result) {
  if (game.state !== "playing") return;
  game.state = result;
  input.keys.clear();
  input.touch = null;
  const level = LEVELS[game.levelIndex];
  const elapsed = Math.min(level.seconds, Math.max(0, Math.round(level.seconds - game.remaining)));
  if (result === "complete") {
    updateLevelRecord(elapsed);
    game.completedRun = {
      levelId: level.id,
      levelName: level.name,
      seconds: elapsed,
      score: game.score,
      tickers: game.assets.map((asset) => asset.ticker),
    };
    if (game.runMode === "campaign") {
      game.campaignSeconds += elapsed;
      game.campaignScore += game.score;
      game.pendingNextLevel = game.levelIndex < LEVELS.length - 1;
      if (!game.pendingNextLevel) {
        const previousCampaign = game.records.campaign;
        if (!previousCampaign || game.campaignSeconds < previousCampaign.seconds) {
          game.records.campaign = { seconds: game.campaignSeconds, score: game.campaignScore };
        }
      }
    }
    saveRecords();
    updateLevelOptions();
    renderLeaderboard();
  }
  renderBestRun();
  elements.resultKicker.textContent = result === "complete"
    ? `LEVEL ${level.id} CLEAR${game.pendingNextLevel ? " · NEXT UNLOCKED" : " · EXIT REACHED"}`
    : `LEVEL ${level.id} · TIME EXPIRED`;
  elements.resultTitle.textContent = result === "complete" ? "Clean exit." : "Clock’s up.";
  const campaignSummary = game.runMode === "campaign"
    ? game.pendingNextLevel
      ? ` · campaign ${formatClock(game.campaignSeconds)} so far`
      : result === "complete"
        ? ` · campaign ${formatClock(game.campaignSeconds)} total`
        : ""
    : "";
  elements.resultCopy.textContent = `${game.collected} / ${PICKUP_COUNT} tickers · ${game.score} points · ${formatClock(elapsed)} level time${campaignSummary}`;
  elements.retry.innerHTML = game.pendingNextLevel
    ? `Continue to Level ${LEVELS[game.levelIndex + 1].id} <span aria-hidden="true">→</span>`
    : game.runMode === "campaign"
      ? 'Restart campaign <span aria-hidden="true">↻</span>'
      : 'Run it back <span aria-hidden="true">↻</span>';
  elements.share.hidden = result !== "complete";
  elements.downloadScorecard.hidden = result !== "complete";
  elements.shareStatus.textContent = "";
  setOverlayMode(result);
}

function scorecardBlob(result) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 675;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("Scorecard image could not be created."));

  context.fillStyle = "#080b0a";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(167, 217, 180, 0.24)";
  context.lineWidth = 2;
  context.strokeRect(34, 34, canvas.width - 68, canvas.height - 68);
  context.fillStyle = "#a7d9b4";
  context.font = "600 20px SFMono-Regular, Menlo, monospace";
  context.fillText("MERKLE RESEARCH   /   STOCK GAP MAZE", 72, 92);
  context.fillStyle = "#788178";
  context.font = "16px SFMono-Regular, Menlo, monospace";
  context.fillText("RUN VERIFIED   ·   NO TRADING OR TOKEN TRANSFERS", 72, 126);
  context.strokeStyle = "rgba(255, 255, 255, 0.12)";
  context.beginPath();
  context.moveTo(72, 158);
  context.lineTo(1128, 158);
  context.stroke();

  context.fillStyle = "#eff2e9";
  context.font = "500 60px Arial, sans-serif";
  context.fillText(`LEVEL ${result.levelId}`, 72, 246);
  context.fillStyle = "#a7d9b4";
  context.font = "500 34px Arial, sans-serif";
  context.fillText(result.levelName.toUpperCase(), 74, 292);

  context.fillStyle = "#737b73";
  context.font = "14px SFMono-Regular, Menlo, monospace";
  context.fillText("SCORE", 74, 376);
  context.fillText("CLEAR TIME", 440, 376);
  context.fillStyle = "#f0f2ea";
  context.font = "600 76px SFMono-Regular, Menlo, monospace";
  context.fillText(String(result.score).padStart(3, "0"), 72, 464);
  context.font = "600 58px SFMono-Regular, Menlo, monospace";
  context.fillText(formatClock(result.seconds), 438, 464);

  context.fillStyle = "#798178";
  context.font = "14px SFMono-Regular, Menlo, monospace";
  context.fillText("TICKERS COLLECTED", 74, 526);
  context.fillStyle = "#c9d6c8";
  context.font = "600 18px SFMono-Regular, Menlo, monospace";
  context.fillText(result.tickers.join("   /   "), 74, 558);
  context.fillStyle = "#a7d9b4";
  context.font = "14px SFMono-Regular, Menlo, monospace";
  context.fillText("solanastockgapmonitor.site/game.html", 74, 614);
  context.textAlign = "right";
  context.fillStyle = "#737b73";
  context.fillText("COLLECT FIVE · FIND THE EXIT", 1126, 614);
  context.textAlign = "left";

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Scorecard image could not be exported."));
    }, "image/png");
  });
}

function downloadScorecardFile(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

async function downloadScorecard() {
  const result = game.completedRun;
  if (!result) return;
  elements.downloadScorecard.disabled = true;
  elements.shareStatus.textContent = "PREPARING SCORECARD…";
  try {
    const blob = await scorecardBlob(result);
    downloadScorecardFile(blob, `stock-gap-level-${result.levelId}-scorecard.png`);
    elements.shareStatus.textContent = "PNG DOWNLOADED · READY TO SHARE";
  } catch {
    elements.shareStatus.textContent = "COULD NOT EXPORT SCORECARD · TRY AGAIN";
  } finally {
    elements.downloadScorecard.disabled = false;
  }
}

async function shareScorecard() {
  const result = game.completedRun;
  if (!result) return;
  elements.share.disabled = true;
  elements.shareStatus.textContent = "PREPARING SCORECARD…";
  try {
    const blob = await scorecardBlob(result);
    const filename = `stock-gap-level-${result.levelId}-scorecard.png`;
    const file = new File([blob], filename, { type: "image/png" });
    const shareText = `Level ${result.levelId} cleared in ${formatClock(result.seconds)} with ${result.score} points. Collect five tickers and find the exit.`;
    if (typeof navigator.share === "function" && typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: `Stock Gap Maze · Level ${result.levelId}`, text: shareText, files: [file] });
      elements.shareStatus.textContent = "SCORECARD SHARED";
    } else {
      downloadScorecardFile(blob, filename);
      elements.shareStatus.textContent = "PNG DOWNLOADED · READY TO SHARE";
    }
  } catch (error) {
    elements.shareStatus.textContent = error.name === "AbortError" ? "SHARE CANCELLED" : "COULD NOT SHARE SCORECARD · TRY AGAIN";
  } finally {
    elements.share.disabled = false;
  }
}

function marketCellAt(worldX, worldZ) {
  return {
    column: Math.floor(worldX + GRID_WIDTH / 2),
    row: Math.floor(worldZ + GRID_HEIGHT / 2),
  };
}

function canOccupy(worldX, worldZ) {
  const radius = PLAYER_RADIUS;
  const corners = [
    [-radius, -radius],
    [-radius, radius],
    [radius, -radius],
    [radius, radius],
  ];
  for (const [offsetX, offsetZ] of corners) {
    const cell = marketCellAt(worldX + offsetX, worldZ + offsetZ);
    if (cell.row < 0 || cell.row >= GRID_HEIGHT || cell.column < 0 || cell.column >= GRID_WIDTH || LEVEL[cell.row][cell.column] === "#") return false;
  }
  return true;
}

function currentDirection() {
  const left = input.keys.has("ArrowLeft") || input.keys.has("KeyA") || input.touch === "left";
  const right = input.keys.has("ArrowRight") || input.keys.has("KeyD") || input.touch === "right";
  const up = input.keys.has("ArrowUp") || input.keys.has("KeyW") || input.touch === "up";
  const down = input.keys.has("ArrowDown") || input.keys.has("KeyS") || input.touch === "down";
  return { x: Number(right) - Number(left), z: Number(down) - Number(up) };
}

function collectNearbyPickups() {
  for (const [index, pickup] of game.pickups.entries()) {
    if (pickup.collected) continue;
    const distance = Math.hypot(game.playerPosition.x - pickup.position.x, game.playerPosition.z - pickup.position.z);
    if (distance > 0.43) continue;
    pickup.collected = true;
    pickup.group.visible = false;
    game.collected += 1;
    game.score += POINTS_PER_PICKUP;
    playPickupChime();
    setScore();
    const row = elements.tickerList.querySelector(`[data-pickup-index="${index}"]`);
    row?.classList.add("is-collected");
    elements.resultCopy.textContent = `${pickup.asset.ticker} collected. +${POINTS_PER_PICKUP} points.`;
    elements.resultCopy.setAttribute("aria-live", "polite");
  }
}

function movePlayer(deltaSeconds) {
  const direction = currentDirection();
  const magnitude = Math.hypot(direction.x, direction.z);
  if (magnitude < 0.01) return;
  direction.x /= magnitude;
  direction.z /= magnitude;
  const deltaX = direction.x * MOVE_SPEED * deltaSeconds;
  const deltaZ = direction.z * MOVE_SPEED * deltaSeconds;
  const nextX = game.playerPosition.x + deltaX;
  const nextZ = game.playerPosition.z + deltaZ;
  if (canOccupy(nextX, game.playerPosition.z)) game.playerPosition.x = nextX;
  if (canOccupy(game.playerPosition.x, nextZ)) game.playerPosition.z = nextZ;
  game.player.position.x = game.playerPosition.x;
  game.player.position.z = game.playerPosition.z;
  game.player.rotation.y = Math.atan2(direction.x, direction.z);
  collectNearbyPickups();
  const exitDistance = Math.hypot(game.playerPosition.x - game.exitPosition.x, game.playerPosition.z - game.exitPosition.z);
  if (exitDistance < 0.42) {
    if (game.collected === PICKUP_COUNT) finishRun("complete");
    else setStatus(`EXIT LOCKED · ${PICKUP_COUNT - game.collected} LEFT`);
  } else if (game.collected > 0) {
    setStatus(`${game.collected} / ${PICKUP_COUNT} COLLECTED`);
  } else {
    setStatus(`${PICKUP_COUNT} ASSETS READY`);
  }
}

function tick(now) {
  game.animationFrame = window.requestAnimationFrame(tick);
  const deltaSeconds = Math.min(0.05, Math.max(0, (now - (game.lastFrame || now)) / 1000));
  game.lastFrame = now;

  if (game.state === "playing") {
    game.remaining = Math.max(0, LEVELS[game.levelIndex].seconds - (now - game.startedAt) / 1000);
    elements.time.textContent = formatClock(game.remaining);
    elements.time.classList.toggle("is-urgent", game.remaining <= 10);
    if (game.remaining <= 0) finishRun("timeout");
    else movePlayer(deltaSeconds);
  }

  const elapsed = now / 1000;
  for (const pickup of game.pickups) {
    if (pickup.collected) continue;
    pickup.coin.rotation.y = elapsed * 0.7 + pickup.phase;
    pickup.coin.position.y = 0.62 + Math.sin(elapsed * 2 + pickup.phase) * 0.07;
    pickup.group.children[1].position.y = pickup.coin.position.y + 0.01;
    pickup.group.children[2].position.y = 1.32 + Math.sin(elapsed * 2 + pickup.phase) * 0.07;
  }
  if (game.exitObject) game.exitObject.rotation.z = Math.sin(elapsed * 1.2) * 0.1;
  if (game.renderer && game.scene && game.camera) game.renderer.render(game.scene, game.camera);
}

function keyForDirection(direction) {
  return { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" }[direction];
}

function attachControls() {
  const movementKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"]);
  window.addEventListener("keydown", (event) => {
    if (game.state !== "playing" || !movementKeys.has(event.code)) return;
    event.preventDefault();
    input.keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => input.keys.delete(event.code));
  window.addEventListener("blur", () => {
    input.keys.clear();
    input.touch = null;
  });

  elements.mobileControls.querySelectorAll("button").forEach((button) => {
    button.addEventListener("pointerdown", (event) => {
      if (game.state !== "playing") return;
      event.preventDefault();
      input.touch = button.dataset.direction;
      button.setPointerCapture?.(event.pointerId);
    });
    const release = () => { input.touch = null; };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });
}

function retryOrContinue() {
  if (game.pendingNextLevel) {
    loadLevel(game.levelIndex + 1);
    startRun();
    return;
  }
  if (game.runMode === "campaign") {
    game.campaignSeconds = 0;
    game.campaignScore = 0;
    if (game.levelIndex !== 0) loadLevel(0);
  }
  resetRun();
  startRun();
}

async function initialize() {
  attachControls();
  game.records = readRecords();
  updateLevelOptions();
  renderLeaderboard();
  renderBestRun();
  updateWelcomePanel();
  elements.runMode.addEventListener("change", updateWelcomePanel);
  elements.levelSelect.addEventListener("change", updateWelcomePanel);
  elements.start.addEventListener("click", startSelectedRun);
  elements.retry.addEventListener("click", retryOrContinue);
  elements.share.addEventListener("click", shareScorecard);
  elements.downloadScorecard.addEventListener("click", downloadScorecard);

  try {
    const [THREE] = await Promise.all([import(THREE_URL), loadAssets()]);
    game.THREE = THREE;
    loadLevel(0);
    game.renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true, alpha: false, powerPreference: "low-power" });
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    game.renderer.outputColorSpace = THREE.SRGBColorSpace;
    game.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    game.renderer.toneMappingExposure = 1.12;
    game.renderer.setClearColor(0x090b0b, 1);
    resizeRenderer();
    game.resizeObserver = new ResizeObserver(resizeRenderer);
    game.resizeObserver.observe(elements.stage);
    game.state = "ready";
    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.start.disabled = false;
    updateWelcomePanel();
    setOverlayMode("ready");
    window.addEventListener("beforeunload", () => {
      game.resizeObserver?.disconnect();
      window.cancelAnimationFrame(game.animationFrame);
      if (game.scene) disposeScene(game.scene);
      game.renderer?.dispose();
      if (game.audioContext && game.audioContext.state !== "closed") game.audioContext.close().catch(() => {});
    }, { once: true });
    game.animationFrame = window.requestAnimationFrame(tick);
  } catch (error) {
    showError(error.message || "The maze could not start. Reload the page to try again.");
    console.error("Stock Gap Maze failed to initialize:", error);
  }
}

initialize();