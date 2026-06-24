const els = {
  townName: document.getElementById("townName"),
  population: document.getElementById("population"),
  crisisType: document.getElementById("crisisType"),
  generateBtn: document.getElementById("generateBtn"),
  nextDayBtn: document.getElementById("nextDayBtn"),
  runBtn: document.getElementById("runBtn"),
  metrics: document.getElementById("metrics"),
  map: document.getElementById("map"),
  eventLog: document.getElementById("eventLog"),
  summary: document.getElementById("summary"),
  agentGrid: document.getElementById("agentGrid"),
  dayLabel: document.getElementById("dayLabel"),
  tinyKpis: document.getElementById("tinyKpis"),
  agentFilter: document.getElementById("agentFilter"),
};

const locations = [
  { id: "homes", name: "Homes", x: 150, y: 130, kind: "residential" },
  { id: "bakery", name: "Bakery", x: 320, y: 120, kind: "business" },
  { id: "market", name: "Market", x: 500, y: 160, kind: "business" },
  { id: "townhall", name: "Town Hall", x: 690, y: 120, kind: "civic" },
  { id: "school", name: "School", x: 825, y: 250, kind: "civic" },
  { id: "farms", name: "Farms", x: 220, y: 370, kind: "production" },
  { id: "factory", name: "Factory", x: 470, y: 360, kind: "production" },
  { id: "clinic", name: "Clinic", x: 720, y: 360, kind: "civic" },
];

const businessTemplates = [
  { id: "bakery", name: "Bakery", type: "food", baseWage: 42, inventory: 120, price: 3.2 },
  { id: "farm", name: "Farm Co-op", type: "food", baseWage: 38, inventory: 180, price: 2.4 },
  { id: "market", name: "Market Hall", type: "retail", baseWage: 40, inventory: 140, price: 4.1 },
  { id: "factory", name: "Foundry 9", type: "industry", baseWage: 55, inventory: 90, price: 5.2 },
];

const firstNames = ["Mira", "Jonah", "Elena", "Iris", "Noah", "Aria", "Sam", "Leah", "Theo", "Nina", "Owen", "Priya", "Zane", "Maya", "Leo", "Sofia", "Evan", "Tara", "Mila", "Kai"];
const lastNames = ["Patel", "Reed", "Cross", "Nguyen", "Bennett", "Ali", "Walker", "Morgan", "Carter", "Hughes", "Lopez", "Singh", "Foster", "James", "Price", "Bell"];
const jobs = ["baker", "farmer", "cashier", "teacher", "nurse", "clerk", "mechanic", "factory worker", "shop owner", "student"];

const state = {
  townName: "",
  day: 0,
  seed: 1,
  rng: null,
  agents: [],
  businesses: [],
  metrics: {},
  events: [],
  rumors: [],
  history: [],
  selectedAgentId: null,
  crisis: null,
  electionActive: false,
  apiBase: "http://127.0.0.1:8000",
  backendEnabled: true,
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRelationship(value) {
  if (!value) return { trust: 0.45, friendship: 0.4, rivalry: 0.1, gossip: 0.5 };
  return {
    trust: toNumber(value.trust, 0.45),
    friendship: toNumber(value.friendship, 0.4),
    rivalry: toNumber(value.rivalry, 0.1),
    gossip: toNumber(value.gossip, 0.5),
  };
}

function normalizeAgent(agent) {
  return {
    ...agent,
    politicalAlignment: toNumber(agent.politicalAlignment ?? agent.political_alignment, 0.5),
    approvalMayor: toNumber(agent.approvalMayor ?? agent.approval_mayor, 0.5),
    protestLikelihood: toNumber(agent.protestLikelihood ?? agent.protest_likelihood, 0),
    socialCircle: agent.socialCircle ?? agent.social_circle ?? [],
    relationships: Object.fromEntries(
      Object.entries(agent.relationships ?? {}).map(([key, value]) => [key, normalizeRelationship(value)])
    ),
    beliefs: {
      mayorTrust: toNumber(agent.beliefs?.mayorTrust ?? agent.beliefs?.mayor_trust, 0.5),
      marketTrust: toNumber(agent.beliefs?.marketTrust ?? agent.beliefs?.market_trust, 0.5),
      rumorBakeryCorruption: toNumber(agent.beliefs?.rumorBakeryCorruption ?? agent.beliefs?.rumor_bakery_corruption, 0.1),
    },
    needs: {
      food: toNumber(agent.needs?.food, 0.5),
      safety: toNumber(agent.needs?.safety, 0.5),
      social: toNumber(agent.needs?.social, 0.5),
      money: toNumber(agent.needs?.money, 0.5),
    },
  };
}

function normalizeBusiness(business) {
  return {
    ...business,
    baseWage: toNumber(business.baseWage ?? business.base_wage, 0),
  };
}

function normalizeRumor(rumor) {
  if (!rumor) return null;
  return {
    ...rumor,
    sourceId: rumor.sourceId ?? rumor.source_id ?? null,
    truthValue: toNumber(rumor.truthValue ?? rumor.truth_value, 0),
    emotionalIntensity: toNumber(rumor.emotionalIntensity ?? rumor.emotional_intensity, 0),
    believers: rumor.believers ?? [],
    skeptics: rumor.skeptics ?? [],
  };
}

function loadSnapshot(snapshot) {
  state.townName = snapshot?.config?.name || snapshot?.id || state.townName;
  state.day = toNumber(snapshot?.day, 0);
  state.crisis = snapshot?.config?.crisisType ?? snapshot?.config?.crisis_type ?? state.crisis;
  state.agents = (snapshot?.agents ?? []).map(normalizeAgent);
  state.businesses = (snapshot?.businesses ?? []).map(normalizeBusiness);
  state.rumors = (snapshot?.rumors ?? []).map(normalizeRumor).filter(Boolean);
  state.events = (snapshot?.history ?? []).map((entry) => ({
    day: toNumber(entry.day, state.day),
    text: entry.text,
  }));
  state.metrics = snapshot?.metrics ?? {};
  state.history = snapshot?.history ?? [];
  state.summary = snapshot?.summary ?? "";
  state.selectedAgentId = state.selectedAgentId && state.agents.some((agent) => agent.id === state.selectedAgentId)
    ? state.selectedAgentId
    : state.agents[0]?.id ?? null;
  state.electionActive = state.crisis === "election";
}

async function callApi(path, options = {}) {
  const response = await fetch(`${state.apiBase}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API ${response.status}: ${text}`);
  }
  return response.json();
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ t >>> 15, 1 | t);
    r ^= r + Math.imul(r ^ r >>> 7, 61 | r);
    return ((r ^ r >>> 14) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function pct(value) {
  return `${Math.round(value)}%`;
}

function money(value) {
  return `$${Math.round(value)}`;
}

function weightedChoice(rng, options) {
  const total = options.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) return option.value;
  }
  return options[options.length - 1].value;
}

async function createTown(name, population, crisisType) {
  if (state.backendEnabled) {
    try {
      const snapshot = await callApi("/towns", {
        method: "POST",
        body: JSON.stringify({
          name,
          population,
          crisisType,
        }),
      });
      loadSnapshot(snapshot);
      render();
      return;
    } catch (error) {
      console.warn("Backend unavailable; falling back to local simulation.", error);
      state.backendEnabled = false;
    }
  }

  const seedFactory = hashString(`${name}:${population}:${crisisType}`);
  state.seed = seedFactory();
  state.rng = mulberry32(state.seed);
  state.day = 0;
  state.townName = name;
  state.agents = [];
  state.businesses = businessTemplates.map((template) => ({ ...template, employees: [], owner: null }));
  state.events = [];
  state.rumors = [];
  state.history = [];
  state.selectedAgentId = null;
  state.crisis = crisisType;
  state.electionActive = crisisType === "election";
  state.protestLogged = false;
  state.warningLogged = false;
  state.electionLogged = false;
  state.lastDailySummary = null;

  const rng = state.rng;
  const districtCenters = [
    { x: 160, y: 140 },
    { x: 320, y: 140 },
    { x: 500, y: 180 },
    { x: 700, y: 140 },
    { x: 230, y: 360 },
    { x: 480, y: 350 },
    { x: 720, y: 350 },
  ];

  for (let i = 0; i < population; i++) {
    const first = firstNames[Math.floor(rng() * firstNames.length)];
    const last = lastNames[Math.floor(rng() * lastNames.length)];
    const personality = {
      openness: rng(),
      conscientiousness: rng(),
      extraversion: rng(),
      agreeableness: rng(),
      neuroticism: rng(),
    };
    const district = districtCenters[Math.floor(rng() * districtCenters.length)];
    const agent = {
      id: `a${i + 1}`,
      name: `${first} ${last}`,
      age: 18 + Math.floor(rng() * 52),
      job: weightedChoice(rng, jobs.map((job) => ({ value: job, weight: job === "student" ? 0.6 : 1 }))),
      employer: null,
      income: 34 + Math.floor(rng() * 45),
      money: 120 + Math.floor(rng() * 260),
      mood: clamp(0.6 + (rng() - 0.5) * 0.25),
      stress: clamp(0.35 + (rng() - 0.5) * 0.3),
      reputation: clamp(0.5 + (rng() - 0.5) * 0.2),
      politicalAlignment: clamp(rng()),
      approvalMayor: clamp(0.45 + (rng() - 0.5) * 0.25),
      personality,
      needs: {
        food: clamp(0.65 + (rng() - 0.5) * 0.15),
        safety: clamp(0.72 + (rng() - 0.5) * 0.12),
        social: clamp(0.52 + (rng() - 0.5) * 0.2),
        money: clamp(0.45 + (rng() - 0.5) * 0.25),
      },
      beliefs: {
        mayorTrust: clamp(0.5 + (rng() - 0.5) * 0.28),
        marketTrust: clamp(0.68 + (rng() - 0.5) * 0.18),
        rumorBakeryCorruption: 0.12,
      },
      relationships: {},
      goals: [],
      memories: [],
      location: "homes",
      home: { x: district.x + (rng() * 60 - 30), y: district.y + (rng() * 40 - 20) },
      work: null,
      socialCircle: [],
      protestLikelihood: 0,
      unemployed: false,
    };
    agent.goals.push(agent.job === "student" ? "finish the term" : "keep household stable");
    agent.goals.push("avoid trouble");
    if (rng() > 0.7) agent.goals.push("help family");
    state.agents.push(agent);
  }

  assignBusinesses();
  wireRelationships();
  applyStartingShock(crisisType);
  addEvent(`Day 0: ${townName} is initialized with ${population} agents and a ${formatCrisis(crisisType)} shock.`);
  updateDerivedState();
  render();
}

function assignBusinesses() {
  const rng = state.rng;
  const employers = [
    { businessId: "bakery", role: "baker" },
    { businessId: "farm", role: "farmer" },
    { businessId: "market", role: "cashier" },
    { businessId: "factory", role: "factory worker" },
  ];
  const candidates = [...state.agents].sort(() => rng() - 0.5);

  for (const business of state.businesses) {
    business.employees = [];
    business.owner = null;
  }

  for (const agent of candidates.slice(0, Math.max(4, Math.floor(state.agents.length / 6)))) {
    const homeBusiness = weightedChoice(rng, [
      { value: "bakery", weight: 2 },
      { value: "market", weight: 2 },
      { value: "factory", weight: 1.2 },
      { value: "farm", weight: 1.2 },
    ]);
    agent.employer = homeBusiness;
  }

  const employed = state.agents.filter((agent) => agent.employer);
  for (const agent of employed) {
    const business = state.businesses.find((item) => item.id === agent.employer);
    if (!business) continue;
    business.employees.push(agent.id);
    if (!business.owner) business.owner = agent.id;
  }

  for (const employer of employers) {
    const target = state.businesses.find((item) => item.id === employer.businessId);
    if (target && target.employees.length === 0) {
      const agent = candidates.find((candidate) => !candidate.employer && candidate.job === employer.role);
      if (agent) {
        agent.employer = employer.businessId;
        target.employees.push(agent.id);
        target.owner = agent.id;
      }
    }
  }

  for (const agent of state.agents) {
    if (!agent.employer) {
      agent.unemployed = true;
      agent.job = "unemployed";
    }
  }
}

function wireRelationships() {
  for (const agent of state.agents) {
    const peers = [...state.agents].filter((peer) => peer.id !== agent.id);
    peers.sort(() => state.rng() - 0.5);
    const links = peers.slice(0, 4 + Math.floor(state.rng() * 3));
    for (const peer of links) {
      const closeness = clamp(0.2 + state.rng() * 0.8);
      agent.relationships[peer.id] = {
        trust: clamp(0.35 + (state.rng() - 0.5) * 0.5),
        friendship: closeness,
        rivalry: clamp(state.rng() * 0.35),
        gossip: clamp(0.3 + state.rng() * 0.7),
      };
    }
    agent.socialCircle = links.map((item) => item.id);
  }
}

function applyStartingShock(type) {
  if (type === "bakery") {
    const bakery = state.businesses.find((item) => item.id === "bakery");
    if (bakery) bakery.closed = true;
    state.agents.filter((agent) => agent.employer === "bakery").forEach((agent) => {
      agent.unemployed = true;
      agent.employer = null;
      agent.job = "unemployed";
      agent.stress = clamp(agent.stress + 0.18);
      agent.memories.push("Lost work when the bakery closed.");
    });
    addEvent("The bakery closes, and a wave of job loss hits the east side.");
  }
  if (type === "shortage") {
    const market = state.businesses.find((item) => item.id === "market");
    if (market) market.inventory = Math.max(25, market.inventory * 0.55);
    addEvent("A food shortage pushes up prices at the market.");
  }
  if (type === "factory") {
    const factory = state.businesses.find((item) => item.id === "factory");
    if (factory) factory.inventory += 80;
    addEvent("A new factory opens and promises steady wages, but also louder arguments.");
    hireForFactory();
  }
  if (type === "flood") {
    const affected = state.agents.filter((_, index) => index % 4 === 0);
    for (const agent of affected) {
      agent.needs.safety = clamp(agent.needs.safety - 0.22);
      agent.stress = clamp(agent.stress + 0.2);
      agent.memories.push("A flood damaged part of the neighborhood.");
    }
    addEvent("Floodwater damages homes near the river district.");
  }
  if (type === "rumour") {
    createRumor("The mayor helped the landlord force the bakery to close.", null, 0.55);
    addEvent("A rumour starts near the market about the mayor and the bakery.");
  }
  if (type === "election") {
    state.electionActive = true;
    addEvent("An election begins. Every bad decision will now be turned into a campaign message.");
  }
}

function hireForFactory() {
  const factory = state.businesses.find((item) => item.id === "factory");
  if (!factory) return;
  const candidates = state.agents.filter((agent) => agent.unemployed).sort(() => state.rng() - 0.5).slice(0, 3);
  for (const agent of candidates) {
    agent.unemployed = false;
    agent.employer = "factory";
    agent.job = "factory worker";
    agent.income += 10;
    factory.employees.push(agent.id);
    agent.memories.push("Was hired by the new factory.");
  }
}

function formatCrisis(type) {
  return {
    bakery: "bakery closure",
    shortage: "food shortage",
    factory: "factory opening",
    flood: "flood",
    rumour: "rumour",
    election: "election",
  }[type] || type;
}

function addEvent(text, tone = "neutral") {
  state.events.unshift({ day: state.day, text, tone });
  state.events = state.events.slice(0, 14);
  state.history.push({ day: state.day, text });
}

function createRumor(claim, sourceId = null, intensity = 0.5) {
  const rumor = {
    claim,
    sourceId,
    truthValue: clamp(0.2 + state.rng() * 0.5),
    emotionalIntensity: clamp(intensity),
    believers: new Set(sourceId ? [sourceId] : []),
    skeptics: new Set(),
  };
  state.rumors.push(rumor);
  return rumor;
}

async function advanceDay() {
  if (state.backendEnabled) {
    try {
      const snapshot = await callApi(`/towns/${encodeURIComponent(state.townName)}/step?days=1`, {
        method: "POST",
      });
      loadSnapshot(snapshot);
      render();
      return;
    } catch (error) {
      console.warn("Backend step failed; falling back to local simulation.", error);
      state.backendEnabled = false;
    }
  }

  state.day += 1;
  const rng = state.rng;
  const moodBefore = average(state.agents.map((agent) => agent.mood));
  const stressBefore = average(state.agents.map((agent) => agent.stress));

  if (state.day === 1) {
    if (state.crisis === "bakery") {
      const narrator = pickAgent((agent) => !agent.unemployed);
      createRumor("The landlord squeezed the bakery rent because the mayor wanted a favor.", narrator?.id || null, 0.72);
      addEvent("Jonah-like whispers spread the first corruption rumor.");
    }
    if (state.crisis === "shortage") {
      addEvent("Families notice that bread and vegetables now cost more than yesterday.");
    }
  }

  updateEconomy();
  updateNeedsAndStress();
  moveAndTalk();
  spreadRumors();
  updatePolitics();
  createDailyEventSummary(moodBefore, stressBefore);
  updateDerivedState();
  render();
}

async function runDays(days = 30) {
  if (state.backendEnabled) {
    try {
      const snapshot = await callApi(`/towns/${encodeURIComponent(state.townName)}/run?days=${days}`, {
        method: "POST",
      });
      loadSnapshot(snapshot);
      render();
      return;
    } catch (error) {
      console.warn("Backend run failed; falling back to local simulation.", error);
      state.backendEnabled = false;
    }
  }

  for (let i = 0; i < days; i++) {
    await advanceDay();
  }
}

function updateEconomy() {
  const rng = state.rng;
  for (const business of state.businesses) {
    if (business.closed) continue;
    const demandShock = state.crisis === business.id ? 0.7 : 1;
    const employeeCount = business.employees.length;
    business.inventory = Math.max(0, business.inventory + Math.round((employeeCount * 1.8) - (6 + rng() * 4) * demandShock));
    const inventoryPressure = business.inventory < 60 ? 1.25 : 1;
    business.price = clampPrice(business.price + (rng() - 0.5) * 0.15 + (60 - business.inventory) * 0.003 * inventoryPressure, 1.2, 9.5);
  }

  const bakery = state.businesses.find((item) => item.id === "bakery");
  const market = state.businesses.find((item) => item.id === "market");
  if (state.crisis === "bakery" && bakery) {
    bakery.closed = true;
    bakery.price = 0;
  }
  if (state.crisis === "shortage" && market) {
    market.price = clampPrice(market.price + 0.12, 1.5, 10);
  }

  for (const agent of state.agents) {
    if (agent.employer) {
      const business = state.businesses.find((item) => item.id === agent.employer);
      if (business && !business.closed) {
        const wage = business.baseWage + Math.round((rng() - 0.5) * 6);
        agent.money += wage;
        agent.income = Math.round(agent.income * 0.75 + wage * 0.25);
      } else {
        agent.unemployed = true;
        agent.employer = null;
        agent.job = "unemployed";
      }
    } else {
      agent.money = Math.max(0, agent.money - 5 - Math.round(rng() * 4));
    }
    if (agent.money < 60) {
      agent.stress = clamp(agent.stress + 0.04);
      agent.needs.money = clamp(agent.needs.money + 0.05);
    }

    if (agent.unemployed) {
      agent.location = agent.stress > 0.6 ? "townhall" : "market";
    } else if (agent.employer) {
      agent.location = agent.employer;
    }
  }
}

function updateNeedsAndStress() {
  const market = state.businesses.find((item) => item.id === "market");
  const foodPrice = market ? market.price : 4;
  for (const agent of state.agents) {
    const foodStress = clamp((foodPrice - 3) * 0.06);
    const unemploymentStress = agent.unemployed ? 0.08 : 0.01;
    const rumorStress = agent.beliefs.rumorBakeryCorruption > 0.4 ? 0.03 : 0;
    const neighborhoodStress = state.crisis === "flood" ? 0.03 : 0;

    agent.needs.food = clamp(agent.needs.food - 0.05 + (agent.money < 80 ? 0.03 : 0));
    agent.needs.social = clamp(agent.needs.social - 0.01 + (agent.socialCircle.length > 0 ? 0.01 : 0));
    agent.needs.safety = clamp(agent.needs.safety - neighborhoodStress);

    agent.stress = clamp(agent.stress + foodStress + unemploymentStress + rumorStress + (1 - agent.needs.food) * 0.015);
    agent.mood = clamp(agent.mood + (agent.needs.food - 0.5) * 0.04 - agent.stress * 0.03);
    agent.protestLikelihood = clamp(agent.protestLikelihood * 0.6 + agent.stress * 0.25 + (1 - agent.approvalMayor) * 0.2);

    if (agent.stress > 0.72 && rngChance(0.16)) {
      agent.memories.unshift("Had a difficult day and felt the town slipping.");
      agent.memories = agent.memories.slice(0, 6);
    }
  }
}

function moveAndTalk() {
  const rng = state.rng;
  const talkers = [...state.agents].sort(() => rng() - 0.5).slice(0, Math.max(4, Math.floor(state.agents.length * 0.45)));
  for (const agent of talkers) {
    if (agent.unemployed) {
      agent.location = agent.stress > 0.65 ? "townhall" : "market";
    } else if (rngChance(0.55)) {
      agent.location = rngChance(0.4) ? "market" : agent.employer;
    }
    const neighbors = agent.socialCircle
      .map((id) => state.agents.find((candidate) => candidate.id === id))
      .filter(Boolean)
      .sort(() => rng() - 0.5)
      .slice(0, 2 + Math.floor(rng() * 2));

    for (const neighbor of neighbors) {
      interact(agent, neighbor);
    }
  }
}

function interact(agent, neighbor) {
  const relation = agent.relationships[neighbor.id] || {
    trust: 0.45,
    friendship: 0.4,
    rivalry: 0.1,
    gossip: 0.5,
  };
  const stressExchange = (neighbor.stress - agent.stress) * 0.04;
  agent.stress = clamp(agent.stress + stressExchange - relation.friendship * 0.01);
  neighbor.stress = clamp(neighbor.stress - stressExchange * 0.25);

  if (state.rumors.length) {
    const rumor = state.rumors[0];
    const sourceTrust = relation.trust + relation.friendship * 0.25 - relation.rivalry * 0.2;
    const beliefChance = clamp(sourceTrust + rumor.emotionalIntensity * 0.2 + (1 - agent.beliefs.mayorTrust) * 0.35);
    if (rngChance(beliefChance * 0.35)) {
      agent.beliefs.rumorBakeryCorruption = clamp(agent.beliefs.rumorBakeryCorruption + 0.12);
      rumor.believers.add(agent.id);
      neighbor.relationships[agent.id] = neighbor.relationships[agent.id] || { trust: 0.4, friendship: 0.3, rivalry: 0.1, gossip: 0.4 };
      neighbor.relationships[agent.id].trust = clamp(neighbor.relationships[agent.id].trust + 0.02);
      agent.memories.unshift(`Heard ${neighbor.name} mention the bakery rumor.`);
      agent.memories = agent.memories.slice(0, 6);
    }
  }

  if (agent.unemployed && neighbor.unemployed && rngChance(0.15 + agent.stress * 0.1)) {
    agent.approvalMayor = clamp(agent.approvalMayor - 0.03);
    neighbor.approvalMayor = clamp(neighbor.approvalMayor - 0.02);
  }
}

function spreadRumors() {
  if (!state.rumors.length) return;
  const rumor = state.rumors[0];
  for (const agent of state.agents) {
    if (rumor.believers.has(agent.id)) continue;
    const neighborhood = agent.socialCircle.map((id) => state.agents.find((candidate) => candidate.id === id)).filter(Boolean);
    const believerNeighbors = neighborhood.filter((peer) => rumor.believers.has(peer.id)).length;
    const exposure = believerNeighbors / Math.max(1, neighborhood.length);
    const trustPenalty = 1 - agent.beliefs.mayorTrust;
    const susceptibility = clamp(exposure * 0.7 + trustPenalty * 0.4 + agent.personality.neuroticism * 0.2 + agent.stress * 0.25);
    if (rngChance(susceptibility * 0.42)) {
      rumor.believers.add(agent.id);
      agent.beliefs.rumorBakeryCorruption = clamp(agent.beliefs.rumorBakeryCorruption + 0.14);
      agent.approvalMayor = clamp(agent.approvalMayor - 0.05);
      agent.memories.unshift("Heard a strong claim about the mayor.");
      agent.memories = agent.memories.slice(0, 6);
    }
  }
  if (rumor.believers.size > Math.floor(state.agents.length * 0.38) && !rumor.reported) {
    rumor.reported = true;
    addEvent(`The rumor gains momentum. ${rumor.believers.size} citizens now repeat it.`);
  }
}

function updatePolitics() {
  const avgApproval = average(state.agents.map((agent) => agent.approvalMayor));
  const protestors = state.agents.filter((agent) => agent.protestLikelihood > 0.62);
  if (protestors.length >= 3 && !state.protestLogged) {
    state.protestLogged = true;
    addEvent(`${protestors.length} agents begin organizing a protest group in response to local stress.`);
  }
  if (state.electionActive && !state.electionLogged && state.day >= 7) {
    state.electionLogged = true;
    addEvent(`The election heats up as approval settles at ${pct(avgApproval)}.`);
  }
  if (avgApproval < 0.44 && !state.warningLogged) {
    state.warningLogged = true;
    addEvent(`Mayor approval falls below 44%. Business owners stay loyal, but the south district is turning.`);
  }
}

function createDailyEventSummary(prevMood, prevStress) {
  const avgMood = average(state.agents.map((agent) => agent.mood));
  const avgStress = average(state.agents.map((agent) => agent.stress));
  const avgApproval = average(state.agents.map((agent) => agent.approvalMayor));
  const unemployed = state.agents.filter((agent) => agent.unemployed).length;
  const rumorBelievers = state.rumors[0]?.believers.size || 0;

  const turningPoint = [];
  if (avgStress > prevStress + 0.04) turningPoint.push("stress rose");
  if (avgMood < prevMood - 0.03) turningPoint.push("mood declined");
  if (unemployed > state.agents.length * 0.3) turningPoint.push("unemployment spread");
  if (rumorBelievers > Math.floor(state.agents.length * 0.4)) turningPoint.push("rumor became mainstream");
  if (turningPoint.length) {
    addEvent(`Day ${state.day}: ${turningPoint.join(", ")}.`);
  } else {
    addEvent(`Day ${state.day}: life continued with small local shifts.`);
  }
  state.lastDailySummary = { avgMood, avgStress, avgApproval, unemployed, rumorBelievers };
}

function updateDerivedState() {
  state.metrics = {
    happiness: average(state.agents.map((agent) => agent.mood)) * 100,
    unemployment: (state.agents.filter((agent) => agent.unemployed).length / state.agents.length) * 100,
    crime: clamp(0.06 + average(state.agents.map((agent) => agent.stress)) * 0.28 + average(state.agents.map((agent) => agent.needs.money)) * 0.12) * 100,
    foodPrices: (state.businesses.find((item) => item.id === "market")?.price || 4) * 2.2,
    approval: average(state.agents.map((agent) => agent.approvalMayor)) * 100,
    inequality: calcInequality() * 100,
    rumors: state.rumors[0]?.believers.size || 0,
  };
}

function calcInequality() {
  const moneyValues = state.agents.map((agent) => agent.money).sort((a, b) => a - b);
  const n = moneyValues.length;
  const sum = moneyValues.reduce((acc, val) => acc + val, 0);
  if (!n || sum === 0) return 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) weighted += (i + 1) * moneyValues[i];
  return (2 * weighted) / (n * sum) - (n + 1) / n;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampPrice(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function rngChance(chance) {
  return state.rng() < chance;
}

function pickAgent(predicate) {
  const matches = state.agents.filter(predicate);
  if (!matches.length) return null;
  return matches[Math.floor(state.rng() * matches.length)];
}

function render() {
  renderMetrics();
  renderMap();
  renderEvents();
  renderSummary();
  renderAgents();
  els.dayLabel.textContent = `Day ${state.day}`;
}

function renderMetrics() {
  const metrics = [
    ["Average happiness", pct(state.metrics.happiness || 0), "Mood across the town"],
    ["Unemployment", pct(state.metrics.unemployment || 0), "Agents without work"],
    ["Crime pressure", pct(state.metrics.crime || 0), "Risk from stress and scarcity"],
    ["Food prices", `$${(state.metrics.foodPrices || 0).toFixed(2)}`, "Market basket proxy"],
    ["Mayor approval", pct(state.metrics.approval || 0), "Town trust in leadership"],
    ["Wealth inequality", pct(state.metrics.inequality || 0), "Income gap indicator"],
    ["Rumor spread", `${state.metrics.rumors || 0}`, "Believers in top rumor"],
  ];
  els.metrics.innerHTML = metrics.map(([label, value, note]) => `
    <article class="metric">
      <div class="metric-label">${label}</div>
      <div class="metric-value">${value}</div>
      <div class="metric-note">${note}</div>
    </article>
  `).join("");

  els.tinyKpis.innerHTML = [
    `<span class="chip">Day ${state.day}</span>`,
    `<span class="chip">${state.agents.filter((a) => a.unemployed).length} unemployed</span>`,
    `<span class="chip">${state.rumors.length} rumor thread${state.rumors.length === 1 ? "" : "s"}</span>`,
  ].join("");
}

function renderMap() {
  const svg = els.map;
  svg.innerHTML = "";
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  defs.innerHTML = `
    <filter id="glow"><feGaussianBlur stdDeviation="6" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter>
  `;
  svg.appendChild(defs);

  for (const location of locations) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", location.x - 52);
    rect.setAttribute("y", location.y - 28);
    rect.setAttribute("width", 104);
    rect.setAttribute("height", 56);
    rect.setAttribute("rx", 16);
    rect.setAttribute("fill", locationFill(location.kind));
    rect.setAttribute("stroke", "rgba(255,255,255,0.12)");
    rect.setAttribute("stroke-width", "1");
    rect.setAttribute("opacity", "0.9");
    group.appendChild(rect);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", location.x);
    text.setAttribute("y", location.y + 6);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("fill", "#f8fafc");
    text.setAttribute("font-size", "14");
    text.setAttribute("font-weight", "700");
    text.textContent = location.name;
    group.appendChild(text);
    svg.appendChild(group);
  }

  for (const agent of state.agents) {
    const loc = locations.find((entry) => entry.id === agent.location) || locations[0];
    const jitterX = (agent.id.charCodeAt(1) * 37) % 44 - 22;
    const jitterY = (agent.id.charCodeAt(1) * 19) % 32 - 16;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", loc.x + jitterX);
    circle.setAttribute("cy", loc.y + 42 + jitterY);
    circle.setAttribute("r", agent.id === state.selectedAgentId ? 7 : 5);
    circle.setAttribute("fill", agent.unemployed ? "#f97316" : agent.stress > 0.7 ? "#ef4444" : "#38bdf8");
    circle.setAttribute("filter", "url(#glow)");
    circle.setAttribute("opacity", "0.95");
    circle.addEventListener("click", () => {
      state.selectedAgentId = agent.id;
      renderAgents();
    });
    svg.appendChild(circle);
  }
}

function locationFill(kind) {
  switch (kind) {
    case "business": return "rgba(245, 158, 11, 0.18)";
    case "civic": return "rgba(56, 189, 248, 0.18)";
    case "production": return "rgba(34, 197, 94, 0.16)";
    default: return "rgba(255,255,255,0.08)";
  }
}

function renderEvents() {
  els.eventLog.innerHTML = state.events.map((event) => `
    <div class="event">
      <strong>Day ${event.day}</strong>
      <div>${event.text}</div>
    </div>
  `).join("");
}

function renderSummary() {
  const avgApproval = state.metrics.approval || 0;
  const topAgent = [...state.agents].sort((a, b) => b.protestLikelihood - a.protestLikelihood)[0];
  const rumor = state.rumors[0];
  const summary = [];
  if (state.summary) {
    summary.push(state.summary.split(/\n+/).filter(Boolean).map((line) => `<p>${line}</p>`).join(""));
  }
  summary.push(`<p><strong>${state.townName}</strong> has run for ${state.day} day${state.day === 1 ? "" : "s"}.</p>`);
  summary.push(`<p>Average happiness is ${pct(state.metrics.happiness || 0)} and mayor approval sits at ${pct(avgApproval)}.</p>`);
  summary.push(`<p>Unemployment is ${pct(state.metrics.unemployment || 0)} with food prices at $${(state.metrics.foodPrices || 0).toFixed(2)}.</p>`);
  if (topAgent) {
    summary.push(`<p>The most volatile agent is <strong>${topAgent.name}</strong>, whose protest likelihood is ${pct(topAgent.protestLikelihood * 100)}.</p>`);
  }
  if (rumor) {
    summary.push(`<p>The dominant rumor has reached ${rumor.believers.size} believer${rumor.believers.size === 1 ? "" : "s"}.</p>`);
  }
  summary.push("<ul>");
  summary.push(state.history.slice(-5).map((entry) => `<li>Day ${entry.day}: ${entry.text}</li>`).join(""));
  summary.push("</ul>");
  els.summary.innerHTML = summary.join("");
}

function renderAgents() {
  const filter = els.agentFilter.value;
  const agents = state.agents.filter((agent) => {
    if (filter === "unemployed") return agent.unemployed;
    if (filter === "stressed") return agent.stress > 0.65;
    if (filter === "protest") return agent.protestLikelihood > 0.55;
    return true;
  });

  els.agentGrid.innerHTML = agents.map((agent) => {
    const selected = agent.id === state.selectedAgentId ? "selected" : "";
    return `
      <article class="agent ${selected}" data-agent-id="${agent.id}">
        <div>
          <h3>${agent.name}</h3>
          <div class="job">${agent.job}${agent.unemployed ? " · unemployed" : ""}</div>
        </div>
        <div class="details">
          <div class="detail-row"><span>Money</span><strong>${money(agent.money)}</strong></div>
          <div class="detail-row"><span>Mood</span><strong>${pct(agent.mood * 100)}</strong></div>
          <div class="detail-row"><span>Stress</span><strong>${pct(agent.stress * 100)}</strong></div>
          <div class="bars">
            <div class="bar"><span style="width:${pct(agent.needs.food * 100)}; background:#f59e0b"></span></div>
            <div class="bar"><span style="width:${pct(agent.needs.safety * 100)}; background:#38bdf8"></span></div>
            <div class="bar"><span style="width:${pct(agent.needs.social * 100)}; background:#22c55e"></span></div>
          </div>
          <div class="detail-row"><span>Mayor trust</span><strong>${pct(agent.beliefs.mayorTrust * 100)}</strong></div>
          <div class="detail-row"><span>Rumor belief</span><strong>${pct(agent.beliefs.rumorBakeryCorruption * 100)}</strong></div>
          <div class="detail-row"><span>Protest risk</span><strong>${pct(agent.protestLikelihood * 100)}</strong></div>
        </div>
      </article>
    `;
  }).join("");

  els.agentGrid.querySelectorAll(".agent").forEach((card) => {
    card.addEventListener("click", () => {
      state.selectedAgentId = card.dataset.agentId;
      renderAgents();
    });
  });

  if (state.selectedAgentId) {
    const selected = state.agents.find((agent) => agent.id === state.selectedAgentId);
    if (selected) {
      const selectedCard = els.agentGrid.querySelector(`[data-agent-id="${selected.id}"]`);
      if (selectedCard) selectedCard.insertAdjacentHTML("beforeend", selectedDetailsMarkup(selected));
    }
  }
}

function selectedDetailsMarkup(agent) {
  const keyRelationships = Object.entries(agent.relationships)
    .slice(0, 3)
    .map(([id, rel]) => {
      const other = state.agents.find((item) => item.id === id);
      return `<div class="detail-row"><span>${other ? other.name : id}</span><strong>${pct(rel.trust * 100)}</strong></div>`;
    }).join("");
  const memory = agent.memories.slice(0, 2).map((item) => `<li>${item}</li>`).join("");
  return `
    <div class="details" style="margin-top: 4px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);">
      <div><strong>Goals</strong></div>
      <ul>${agent.goals.map((goal) => `<li>${goal}</li>`).join("")}</ul>
      <div><strong>Recent memories</strong></div>
      <ul>${memory || "<li>No strong memory yet.</li>"}</ul>
      <div><strong>Relationships</strong></div>
      ${keyRelationships || "<div class='detail-row'><span>Quiet this week</span><strong>-</strong></div>"}
    </div>
  `;
}

function bindEvents() {
  els.generateBtn.addEventListener("click", () => {
    const population = Math.max(12, Math.min(120, Number(els.population.value) || 25));
    void createTown(els.townName.value.trim() || "Hollowbrook", population, els.crisisType.value);
  });
  els.nextDayBtn.addEventListener("click", () => void advanceDay());
  els.runBtn.addEventListener("click", () => void runDays(30));
  els.agentFilter.addEventListener("change", renderAgents);
}

bindEvents();
void createTown(els.townName.value, Number(els.population.value), els.crisisType.value);
