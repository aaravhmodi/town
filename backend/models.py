from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class Personality(BaseModel):
    openness: float
    conscientiousness: float
    extraversion: float
    agreeableness: float
    neuroticism: float


class Needs(BaseModel):
    food: float
    safety: float
    social: float
    money: float


class Beliefs(BaseModel):
    mayor_trust: float = Field(alias="mayorTrust")
    market_trust: float = Field(alias="marketTrust")
    rumor_bakery_corruption: float = Field(alias="rumorBakeryCorruption")

    model_config = {"populate_by_name": True}


class Relationship(BaseModel):
    trust: float
    friendship: float
    rivalry: float
    gossip: float


class Agent(BaseModel):
    id: str
    name: str
    age: int
    job: str
    employer: Optional[str] = None
    income: float
    money: float
    mood: float
    stress: float
    reputation: float
    political_alignment: float = Field(alias="politicalAlignment")
    approval_mayor: float = Field(alias="approvalMayor")
    personality: Personality
    needs: Needs
    beliefs: Beliefs
    relationships: Dict[str, Relationship] = Field(default_factory=dict)
    goals: List[str] = Field(default_factory=list)
    memories: List[str] = Field(default_factory=list)
    location: str = "homes"
    protest_likelihood: float = 0.0
    unemployed: bool = False
    social_circle: List[str] = Field(default_factory=list, alias="socialCircle")

    model_config = {"populate_by_name": True}


class Business(BaseModel):
    id: str
    name: str
    type: str
    base_wage: float = Field(alias="baseWage")
    inventory: float
    price: float
    employees: List[str] = Field(default_factory=list)
    owner: Optional[str] = None
    closed: bool = False

    model_config = {"populate_by_name": True}


class Rumor(BaseModel):
    claim: str
    source_id: Optional[str] = Field(default=None, alias="sourceId")
    truth_value: float = Field(alias="truthValue")
    emotional_intensity: float = Field(alias="emotionalIntensity")
    believers: List[str] = Field(default_factory=list)
    skeptics: List[str] = Field(default_factory=list)
    reported: bool = False

    model_config = {"populate_by_name": True}


class TownConfig(BaseModel):
    name: str
    population: int = Field(ge=12, le=120)
    crisis_type: Literal["bakery", "shortage", "factory", "flood", "rumour", "election"] = Field(alias="crisisType")

    model_config = {"populate_by_name": True}


class TownSnapshot(BaseModel):
    id: str
    config: TownConfig
    day: int = 0
    agents: List[Agent]
    businesses: List[Business]
    rumors: List[Rumor] = Field(default_factory=list)
    events: List[str] = Field(default_factory=list)
    metrics: Dict[str, float] = Field(default_factory=dict)
    summary: str = ""
    history: List[Dict[str, str]] = Field(default_factory=list)

