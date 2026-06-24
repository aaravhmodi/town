from __future__ import annotations

import math
import random
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .gemini import generate_text
from .models import Agent, Beliefs, Business, Needs, Personality, Relationship, Rumor, TownConfig, TownSnapshot
from .nlp import choose_relevant_memories, semantic_affinity

FIRST_NAMES = ["Mira", "Jonah", "Elena", "Iris", "Noah", "Aria", "Sam", "Leah", "Theo", "Nina", "Owen", "Priya", "Zane", "Maya", "Leo", "Sofia", "Evan", "Tara", "Mila", "Kai"]
LAST_NAMES = ["Patel", "Reed", "Cross", "Nguyen", "Bennett", "Ali", "Walker", "Morgan", "Carter", "Hughes", "Lopez", "Singh", "Foster", "James", "Price", "Bell"]
JOBS = ["baker", "farmer", "cashier", "teacher", "nurse", "clerk", "mechanic", "factory worker", "shop owner", "student"]


def clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def pct(value: float) -> float:
    return round(value * 100, 2)


def seed_from_name(name: str) -> int:
    return abs(hash(name)) % (2**32)


@dataclass
class TownState:
    config: TownConfig
    rng: random.Random
    day: int = 0
    agents: List[Agent] = field(default_factory=list)
    businesses: List[Business] = field(default_factory=list)
    rumors: List[Rumor] = field(default_factory=list)
    events: List[str] = field(default_factory=list)
    history: List[Dict[str, str]] = field(default_factory=list)
    summary: str = ""
    election_active: bool = False
    protest_logged: bool = False
    warning_logged: bool = False
    election_logged: bool = False

    def snapshot(self) -> TownSnapshot:
        return TownSnapshot(
            id=self.config.name,
            config=self.config,
            day=self.day,
            agents=self.agents,
            businesses=self.businesses,
            rumors=self.rumors,
            events=self.events,
            metrics=self.metrics(),
            summary=self.summary,
            history=self.history,
        )

    def metrics(self) -> Dict[str, float]:
        happiness = sum(agent.mood for agent in self.agents) / max(1, len(self.agents))
        unemployment = sum(1 for agent in self.agents if agent.unemployed) / max(1, len(self.agents))
        crime = clamp(0.06 + (sum(agent.stress for agent in self.agents) / max(1, len(self.agents))) * 0.28)
        approval = sum(agent.approval_mayor for agent in self.agents) / max(1, len(self.agents))
        inequality = gini([agent.money for agent in self.agents])
        rumors = float(len(self.rumors[0].believers)) if self.rumors else 0.0
        food_price = next((biz.price for biz in self.businesses if biz.id == "market"), 4.0)
        return {
            "happiness": pct(happiness),
            "unemployment": pct(unemployment),
            "crime": pct(crime),
            "foodPrices": round(food_price * 2.2, 2),
            "approval": pct(approval),
            "inequality": pct(inequality),
            "rumors": rumors,
        }


def gini(values: List[float]) -> float:
    ordered = sorted(values)
    n = len(ordered)
    if n == 0:
        return 0.0
    total = sum(ordered)
    if total == 0:
        return 0.0
    weighted = sum((i + 1) * value for i, value in enumerate(ordered))
    return max(0.0, (2 * weighted) / (n * total) - (n + 1) / n)


class TownSimulator:
    def __init__(self) -> None:
        self.towns: Dict[str, TownState] = {}

    def create_town(self, config: TownConfig) -> TownSnapshot:
        rng = random.Random(seed_from_name(f"{config.name}:{config.population}:{config.crisis_type}"))
        state = TownState(config=config, rng=rng, election_active=(config.crisis_type == "election"))
        state.businesses = [
            Business(id="bakery", name="Bakery", type="food", baseWage=42, inventory=120, price=3.2),
            Business(id="farm", name="Farm Co-op", type="food", baseWage=38, inventory=180, price=2.4),
            Business(id="market", name="Market Hall", type="retail", baseWage=40, inventory=140, price=4.1),
            Business(id="factory", name="Foundry 9", type="industry", baseWage=55, inventory=90, price=5.2),
        ]
        state.agents = [self._build_agent(i, rng) for i in range(config.population)]
        self._assign_jobs(state)
        self._wire_relationships(state)
        self._apply_starting_shock(state)
        self._add_event(state, f"Day 0: {config.name} is initialized with {config.population} agents and a {config.crisis_type} shock.")
        state.summary = self._generate_summary(state)
        self.towns[config.name] = state
        return state.snapshot()

    def get_town(self, town_id: str) -> Optional[TownSnapshot]:
        town = self.towns.get(town_id)
        return town.snapshot() if town else None

    def step_town(self, town_id: str, days: int = 1) -> Optional[TownSnapshot]:
        town = self.towns.get(town_id)
        if not town:
            return None
        for _ in range(days):
            self._step_one_day(town)
        town.summary = self._generate_summary(town)
        return town.snapshot()

    def run_town(self, town_id: str, days: int = 30) -> Optional[TownSnapshot]:
        return self.step_town(town_id, days)

    def _build_agent(self, index: int, rng: random.Random) -> Agent:
        first = rng.choice(FIRST_NAMES)
        last = rng.choice(LAST_NAMES)
        job = rng.choices(JOBS, weights=[1, 1, 1, 1, 1, 1, 1, 1, 1, 0.6], k=1)[0]
        personality = Personality(
            openness=rng.random(),
            conscientiousness=rng.random(),
            extraversion=rng.random(),
            agreeableness=rng.random(),
            neuroticism=rng.random(),
        )
        return Agent(
            id=f"a{index + 1}",
            name=f"{first} {last}",
            age=18 + rng.randint(0, 51),
            job=job,
            income=34 + rng.randint(0, 44),
            money=120 + rng.randint(0, 260),
            mood=clamp(0.6 + (rng.random() - 0.5) * 0.25),
            stress=clamp(0.35 + (rng.random() - 0.5) * 0.3),
            reputation=clamp(0.5 + (rng.random() - 0.5) * 0.2),
            politicalAlignment=clamp(rng.random()),
            approvalMayor=clamp(0.45 + (rng.random() - 0.5) * 0.25),
            personality=personality,
            needs=Needs(
                food=clamp(0.65 + (rng.random() - 0.5) * 0.15),
                safety=clamp(0.72 + (rng.random() - 0.5) * 0.12),
                social=clamp(0.52 + (rng.random() - 0.5) * 0.2),
                money=clamp(0.45 + (rng.random() - 0.5) * 0.25),
            ),
            beliefs=Beliefs(
                mayorTrust=clamp(0.5 + (rng.random() - 0.5) * 0.28),
                marketTrust=clamp(0.68 + (rng.random() - 0.5) * 0.18),
                rumorBakeryCorruption=0.12,
            ),
            memories=[],
            goals=["keep household stable", "avoid trouble"],
            location="homes",
        )

    def _assign_jobs(self, town: TownState) -> None:
        rng = town.rng
        unemployed_pool = town.agents[:]
        rng.shuffle(unemployed_pool)
        for agent in unemployed_pool[: max(4, len(town.agents) // 6)]:
            employer = rng.choices(["bakery", "market", "factory", "farm"], weights=[2, 2, 1.2, 1.2], k=1)[0]
            agent.employer = employer
            business = self._business(town, employer)
            business.employees.append(agent.id)
            if business.owner is None:
                business.owner = agent.id
        for agent in town.agents:
            if agent.employer is None:
                agent.unemployed = True
                agent.job = "unemployed"

    def _wire_relationships(self, town: TownState) -> None:
        rng = town.rng
        for agent in town.agents:
            peers = [peer for peer in town.agents if peer.id != agent.id]
            rng.shuffle(peers)
            for peer in peers[: 4 + rng.randint(0, 2)]:
                agent.relationships[peer.id] = Relationship(
                    trust=clamp(0.35 + (rng.random() - 0.5) * 0.5),
                    friendship=clamp(0.2 + rng.random() * 0.8),
                    rivalry=clamp(rng.random() * 0.35),
                    gossip=clamp(0.3 + rng.random() * 0.7),
                )
            agent.social_circle = [peer.id for peer in peers[: 4 + rng.randint(0, 2)]]

    def _apply_starting_shock(self, town: TownState) -> None:
        crisis = town.config.crisis_type
        if crisis == "bakery":
            bakery = self._business(town, "bakery")
            bakery.closed = True
            for agent in town.agents:
                if agent.employer == "bakery":
                    agent.unemployed = True
                    agent.employer = None
                    agent.job = "unemployed"
                    agent.stress = clamp(agent.stress + 0.18)
                    agent.memories.append("Lost work when the bakery closed.")
            self._add_event(town, "The bakery closes, and a wave of job loss hits the east side.")
            self._create_rumor(town, "The landlord squeezed the bakery rent because the mayor wanted a favor.", None, 0.72)
        elif crisis == "shortage":
            market = self._business(town, "market")
            market.inventory = max(25, market.inventory * 0.55)
            self._add_event(town, "A food shortage pushes up prices at the market.")
        elif crisis == "factory":
            factory = self._business(town, "factory")
            factory.inventory += 80
            self._add_event(town, "A new factory opens and promises steady wages, but also louder arguments.")
            self._hire_for_factory(town)
        elif crisis == "flood":
            affected = [agent for idx, agent in enumerate(town.agents) if idx % 4 == 0]
            for agent in affected:
                agent.needs.safety = clamp(agent.needs.safety - 0.22)
                agent.stress = clamp(agent.stress + 0.2)
                agent.memories.append("A flood damaged part of the neighborhood.")
            self._add_event(town, "Floodwater damages homes near the river district.")
        elif crisis == "rumour":
            self._create_rumor(town, "The mayor helped the landlord force the bakery to close.", None, 0.55)
            self._add_event(town, "A rumor starts near the market about the mayor and the bakery.")
        elif crisis == "election":
            town.election_active = True
            self._add_event(town, "An election begins. Every bad decision will now be turned into a campaign message.")

    def _step_one_day(self, town: TownState) -> None:
        town.day += 1
        avg_mood_before = sum(agent.mood for agent in town.agents) / max(1, len(town.agents))
        avg_stress_before = sum(agent.stress for agent in town.agents) / max(1, len(town.agents))

        self._update_economy(town)
        self._update_needs_and_stress(town)
        self._move_and_talk(town)
        self._spread_rumors(town)
        self._update_politics(town)
        self._daily_event_summary(town, avg_mood_before, avg_stress_before)

    def _update_economy(self, town: TownState) -> None:
        rng = town.rng
        for business in town.businesses:
            if business.closed:
                continue
            employee_count = len(business.employees)
            business.inventory = max(0, business.inventory + round((employee_count * 1.8) - (6 + rng.random() * 4)))
            business.price = clamp_price(business.price + (rng.random() - 0.5) * 0.15 + (60 - business.inventory) * 0.003, 1.2, 9.5)
        if town.config.crisis_type == "bakery":
            self._business(town, "bakery").closed = True
        if town.config.crisis_type == "shortage":
            self._business(town, "market").price = clamp_price(self._business(town, "market").price + 0.12, 1.5, 10)

        for agent in town.agents:
            if agent.employer:
                business = self._business(town, agent.employer)
                if not business.closed:
                    wage = business.base_wage + round((rng.random() - 0.5) * 6)
                    agent.money += wage
                    agent.income = round(agent.income * 0.75 + wage * 0.25)
                else:
                    agent.unemployed = True
                    agent.employer = None
                    agent.job = "unemployed"
            else:
                agent.money = max(0, agent.money - 5 - round(rng.random() * 4))
            if agent.money < 60:
                agent.stress = clamp(agent.stress + 0.04)
                agent.needs.money = clamp(agent.needs.money + 0.05)

            if agent.unemployed:
                agent.location = "townhall" if agent.stress > 0.6 else "market"
            elif agent.employer:
                agent.location = agent.employer

    def _update_needs_and_stress(self, town: TownState) -> None:
        food_price = self._business(town, "market").price
        for agent in town.agents:
            food_stress = clamp((food_price - 3) * 0.06)
            unemployment_stress = 0.08 if agent.unemployed else 0.01
            rumor_stress = 0.03 if agent.beliefs.rumor_bakery_corruption > 0.4 else 0.0
            flood_stress = 0.03 if town.config.crisis_type == "flood" else 0.0

            agent.needs.food = clamp(agent.needs.food - 0.05 + (0.03 if agent.money < 80 else 0.0))
            agent.needs.social = clamp(agent.needs.social - 0.01 + (0.01 if agent.social_circle else 0.0))
            agent.needs.safety = clamp(agent.needs.safety - flood_stress)

            agent.stress = clamp(agent.stress + food_stress + unemployment_stress + rumor_stress + (1 - agent.needs.food) * 0.015)
            agent.mood = clamp(agent.mood + (agent.needs.food - 0.5) * 0.04 - agent.stress * 0.03)
            agent.protest_likelihood = clamp(agent.protest_likelihood * 0.6 + agent.stress * 0.25 + (1 - agent.approval_mayor) * 0.2)

            if agent.stress > 0.72 and town.rng.random() < 0.16:
                agent.memories.insert(0, "Had a difficult day and felt the town slipping.")
                agent.memories = agent.memories[:6]

    def _move_and_talk(self, town: TownState) -> None:
        rng = town.rng
        talkers = town.agents[:]
        rng.shuffle(talkers)
        talkers = talkers[: max(4, len(town.agents) // 2)]
        for agent in talkers:
            if agent.unemployed:
                agent.location = "townhall" if agent.stress > 0.65 else "market"
            elif rng.random() < 0.55:
                agent.location = "market" if rng.random() < 0.4 else (agent.employer or "homes")
            neighbors = [self._agent_by_id(town, peer_id) for peer_id in agent.social_circle]
            neighbors = [peer for peer in neighbors if peer is not None]
            rng.shuffle(neighbors)
            for neighbor in neighbors[: 2 + rng.randint(0, 1)]:
                self._interact(town, agent, neighbor)

    def _interact(self, town: TownState, agent: Agent, neighbor: Agent) -> None:
        relation = agent.relationships.get(neighbor.id) or Relationship(trust=0.45, friendship=0.4, rivalry=0.1, gossip=0.5)
        affinity = semantic_affinity(
            f"{agent.job} {agent.personality.model_dump()} {agent.goals}",
            f"{neighbor.job} {neighbor.personality.model_dump()} {neighbor.goals}",
        )
        relation.trust = clamp(relation.trust + (affinity - 0.5) * 0.02)
        stress_exchange = (neighbor.stress - agent.stress) * 0.04
        agent.stress = clamp(agent.stress + stress_exchange - relation.friendship * 0.01)
        neighbor.stress = clamp(neighbor.stress - stress_exchange * 0.25)

        if town.rumors:
            rumor = town.rumors[0]
            source_trust = relation.trust + relation.friendship * 0.25 - relation.rivalry * 0.2
            belief_chance = clamp(source_trust + rumor.emotional_intensity * 0.2 + (1 - agent.beliefs.mayor_trust) * 0.35)
            if town.rng.random() < belief_chance * 0.35:
                agent.beliefs.rumor_bakery_corruption = clamp(agent.beliefs.rumor_bakery_corruption + 0.12)
                if agent.id not in rumor.believers:
                    rumor.believers.append(agent.id)
                agent.memories.insert(0, f"Heard {neighbor.name} mention the bakery rumor.")
                agent.memories = agent.memories[:6]

        if agent.unemployed and neighbor.unemployed and town.rng.random() < (0.15 + agent.stress * 0.1):
            agent.approval_mayor = clamp(agent.approval_mayor - 0.03)
            neighbor.approval_mayor = clamp(neighbor.approval_mayor - 0.02)

    def _spread_rumors(self, town: TownState) -> None:
        if not town.rumors:
            return
        rumor = town.rumors[0]
        for agent in town.agents:
            if agent.id in rumor.believers:
                continue
            neighborhood = [self._agent_by_id(town, peer_id) for peer_id in agent.social_circle]
            neighborhood = [peer for peer in neighborhood if peer is not None]
            believer_neighbors = sum(1 for peer in neighborhood if peer.id in rumor.believers)
            exposure = believer_neighbors / max(1, len(neighborhood))
            trust_penalty = 1 - agent.beliefs.mayor_trust
            susceptibility = clamp(exposure * 0.7 + trust_penalty * 0.4 + agent.personality.neuroticism * 0.2 + agent.stress * 0.25)
            if town.rng.random() < susceptibility * 0.42:
                rumor.believers.append(agent.id)
                agent.beliefs.rumor_bakery_corruption = clamp(agent.beliefs.rumor_bakery_corruption + 0.14)
                agent.approval_mayor = clamp(agent.approval_mayor - 0.05)
                agent.memories.insert(0, "Heard a strong claim about the mayor.")
                agent.memories = agent.memories[:6]
        if len(rumor.believers) > math.floor(len(town.agents) * 0.38) and not rumor.reported:
            rumor.reported = True
            self._add_event(town, f"The rumor gains momentum. {len(rumor.believers)} citizens now repeat it.")

    def _update_politics(self, town: TownState) -> None:
        avg_approval = sum(agent.approval_mayor for agent in town.agents) / max(1, len(town.agents))
        protestors = [agent for agent in town.agents if agent.protest_likelihood > 0.62]
        if len(protestors) >= 3 and not town.protest_logged:
            town.protest_logged = True
            self._add_event(town, f"{len(protestors)} agents begin organizing a protest group in response to local stress.")
        if town.election_active and not town.election_logged and town.day >= 7:
            town.election_logged = True
            self._add_event(town, f"The election heats up as approval settles at {round(avg_approval * 100)}%.")
        if avg_approval < 0.44 and not town.warning_logged:
            town.warning_logged = True
            self._add_event(town, "Mayor approval falls below 44%. Business owners stay loyal, but the south district is turning.")

    def _daily_event_summary(self, town: TownState, prev_mood: float, prev_stress: float) -> None:
        avg_mood = sum(agent.mood for agent in town.agents) / max(1, len(town.agents))
        avg_stress = sum(agent.stress for agent in town.agents) / max(1, len(town.agents))
        unemployed = sum(1 for agent in town.agents if agent.unemployed)
        rumor_believers = len(town.rumors[0].believers) if town.rumors else 0
        turning_point = []
        if avg_stress > prev_stress + 0.04:
            turning_point.append("stress rose")
        if avg_mood < prev_mood - 0.03:
            turning_point.append("mood declined")
        if unemployed > len(town.agents) * 0.3:
            turning_point.append("unemployment spread")
        if rumor_believers > math.floor(len(town.agents) * 0.4):
            turning_point.append("rumor became mainstream")
        if turning_point:
            self._add_event(town, f"Day {town.day}: {', '.join(turning_point)}.")
        else:
            self._add_event(town, f"Day {town.day}: life continued with small local shifts.")

    def _generate_summary(self, town: TownState) -> str:
        top_agent = max(town.agents, key=lambda agent: agent.protest_likelihood, default=None)
        rumor = town.rumors[0] if town.rumors else None
        relevant_memories: List[str] = []
        if top_agent:
            memory_query = " ".join(
                [
                    town.config.crisis_type,
                    f"day {town.day}",
                    "economy stress rumor politics",
                    top_agent.job,
                    top_agent.name,
                ]
            )
            relevant_memories = choose_relevant_memories(memory_query, top_agent.memories, limit=3)
        lines = [
            f"{town.config.name} has run for {town.day} day{'s' if town.day != 1 else ''}.",
            f"Average happiness is {round((sum(agent.mood for agent in town.agents) / max(1, len(town.agents))) * 100)}% and mayor approval sits at {round((sum(agent.approval_mayor for agent in town.agents) / max(1, len(town.agents))) * 100)}%.",
            f"Unemployment is {round((sum(1 for agent in town.agents if agent.unemployed) / max(1, len(town.agents))) * 100)}% with food prices at ${round(self._business(town, 'market').price * 2.2, 2)}.",
        ]
        if top_agent:
            lines.append(f"The most volatile agent is {top_agent.name}, whose protest likelihood is {round(top_agent.protest_likelihood * 100)}%.")
        if relevant_memories:
            lines.append("Relevant memories: " + " | ".join(relevant_memories))
        if rumor:
            lines.append(f"The dominant rumor has reached {len(rumor.believers)} believer{'s' if len(rumor.believers) != 1 else ''}.")

        recent_history = "\n".join(f"- Day {entry['day']}: {entry['text']}" for entry in town.history[-5:])
        base_summary = "\n".join(lines + ([recent_history] if recent_history else []))
        generated = generate_text(
            prompt="Write a concise town history report in 3-5 paragraphs. Keep the tone factual and observational.",
            context=base_summary,
        )
        return generated.strip() or base_summary

    def _hire_for_factory(self, town: TownState) -> None:
        factory = self._business(town, "factory")
        candidates = [agent for agent in town.agents if agent.unemployed]
        town.rng.shuffle(candidates)
        for agent in candidates[:3]:
            agent.unemployed = False
            agent.employer = "factory"
            agent.job = "factory worker"
            agent.income += 10
            factory.employees.append(agent.id)
            agent.memories.append("Was hired by the new factory.")

    def _create_rumor(self, town: TownState, claim: str, source_id: Optional[str], intensity: float) -> Rumor:
        rumor = Rumor(
            claim=claim,
            sourceId=source_id,
            truthValue=clamp(0.2 + town.rng.random() * 0.5),
            emotionalIntensity=clamp(intensity),
            believers=[source_id] if source_id else [],
            skeptics=[],
        )
        town.rumors.append(rumor)
        return rumor

    def _add_event(self, town: TownState, text: str) -> None:
        town.events.insert(0, text)
        town.events = town.events[:14]
        town.history.append({"day": str(town.day), "text": text})

    def _business(self, town: TownState, business_id: str) -> Business:
        for business in town.businesses:
            if business.id == business_id:
                return business
        raise KeyError(business_id)

    def _agent_by_id(self, town: TownState, agent_id: str) -> Optional[Agent]:
        return next((agent for agent in town.agents if agent.id == agent_id), None)


def clamp_price(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))
