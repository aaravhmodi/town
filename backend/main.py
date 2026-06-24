from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import TownConfig, TownSnapshot
from .simulation import TownSimulator

app = FastAPI(title="Town Shock Simulator API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

simulator = TownSimulator()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/towns", response_model=TownSnapshot)
def create_town(config: TownConfig) -> TownSnapshot:
    return simulator.create_town(config)


@app.get("/towns/{town_id}", response_model=TownSnapshot)
def get_town(town_id: str) -> TownSnapshot:
    town = simulator.get_town(town_id)
    if town is None:
      raise HTTPException(status_code=404, detail="Town not found")
    return town


@app.post("/towns/{town_id}/step", response_model=TownSnapshot)
def step_town(town_id: str, days: int = 1) -> TownSnapshot:
    town = simulator.step_town(town_id, days)
    if town is None:
        raise HTTPException(status_code=404, detail="Town not found")
    return town


@app.post("/towns/{town_id}/run", response_model=TownSnapshot)
def run_town(town_id: str, days: int = 30) -> TownSnapshot:
    town = simulator.run_town(town_id, days)
    if town is None:
        raise HTTPException(status_code=404, detail="Town not found")
    return town

