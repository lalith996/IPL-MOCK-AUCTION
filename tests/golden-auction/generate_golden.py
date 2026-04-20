"""
Golden Auction Generator

Produces golden_event_log.json: a deterministic 50-nomination auction
run with seed=42 using simulated (non-LLM) agent decisions.

This fixture is committed to the repository and used in the golden-auction
regression test. Any code change that alters the event sequence will cause
the regression test to fail, alerting the team to audit the change.

Run:
    python tests/golden-auction/generate_golden.py

The fixture is generated from a seeded RNG — no network calls, no LLM,
no database required. All decisions are rule-based using the same scoring
function as the auction manager, driven by the fixed seed.
"""

from __future__ import annotations

import json
import random
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

SEED = 42
NUM_NOMINATIONS = 50
ALL_AGENTS = ["MI", "CSK", "RCB", "DC", "KKR", "RR", "PBKS", "SRH", "LSG", "GT"]
INITIAL_BUDGET_CR = 100.0  # 100 Crore = 10,000 Lakhs
MAX_SQUAD = 25

# Bid-increment bands (lakhs)
INCREMENT_BANDS = [
    (100,  5),
    (200, 10),
    (500, 20),
    (float("inf"), 25),
]

# Player pool (synthetic; representative names/roles/base prices)
PLAYER_POOL = [
    ("p-rohit-sharma",     "Rohit Sharma",     "batsman",    200.0, "Indian",   0.95),
    ("p-virat-kohli",      "Virat Kohli",       "batsman",    200.0, "Indian",   0.97),
    ("p-ms-dhoni",         "MS Dhoni",          "keeper",     200.0, "Indian",   0.90),
    ("p-jasprit-bumrah",   "Jasprit Bumrah",    "pacer",      200.0, "Indian",   0.93),
    ("p-ravindra-jadeja",  "Ravindra Jadeja",   "spinner",    150.0, "Indian",   0.91),
    ("p-suryakumar-yadav", "Suryakumar Yadav",  "batsman",    150.0, "Indian",   0.88),
    ("p-hardik-pandya",    "Hardik Pandya",     "all-rounder",150.0, "Indian",   0.85),
    ("p-shubman-gill",     "Shubman Gill",      "batsman",    100.0, "Indian",   0.87),
    ("p-yashasvi-jaiswal", "Yashasvi Jaiswal",  "batsman",    100.0, "Indian",   0.84),
    ("p-rishabh-pant",     "Rishabh Pant",      "keeper",     200.0, "Indian",   0.89),
    ("p-kl-rahul",         "KL Rahul",          "keeper",     150.0, "Indian",   0.86),
    ("p-ravichandran-ashwin","R Ashwin",         "spinner",    100.0, "Indian",   0.88),
    ("p-yuzvendra-chahal", "Yuzvendra Chahal",  "spinner",    100.0, "Indian",   0.85),
    ("p-axar-patel",       "Axar Patel",        "spinner",    100.0, "Indian",   0.83),
    ("p-mohammed-shami",   "Mohammed Shami",    "pacer",      100.0, "Indian",   0.86),
    ("p-umesh-yadav",      "Umesh Yadav",       "pacer",       75.0, "Indian",   0.78),
    ("p-shardul-thakur",   "Shardul Thakur",    "all-rounder", 75.0, "Indian",   0.80),
    ("p-pat-cummins",      "Pat Cummins",       "pacer",      200.0, "Overseas", 0.92),
    ("p-mitchell-starc",   "Mitchell Starc",    "pacer",      150.0, "Overseas", 0.88),
    ("p-trevor-bayliss",   "T Bayliss Jr",      "batsman",     75.0, "Overseas", 0.60),  # cold-start
    ("p-jos-buttler",      "Jos Buttler",       "keeper",     200.0, "Overseas", 0.91),
    ("p-sam-curran",       "Sam Curran",        "all-rounder",150.0, "Overseas", 0.84),
    ("p-david-warner",     "David Warner",      "batsman",    150.0, "Overseas", 0.87),
    ("p-quinton-de-kock",  "Quinton de Kock",   "keeper",     100.0, "Overseas", 0.82),
    ("p-kagiso-rabada",    "Kagiso Rabada",     "pacer",      200.0, "Overseas", 0.90),
    ("p-rashid-khan",      "Rashid Khan",       "spinner",    200.0, "Overseas", 0.93),
    ("p-sunil-narine",     "Sunil Narine",      "all-rounder",150.0, "Overseas", 0.88),
    ("p-andre-russell",    "Andre Russell",     "all-rounder",150.0, "Overseas", 0.87),
    ("p-faf-du-plessis",   "Faf du Plessis",    "batsman",    100.0, "Overseas", 0.83),
    ("p-nicholas-pooran",  "Nicholas Pooran",   "keeper",     100.0, "Overseas", 0.80),
    ("p-shimron-hetmyer",  "Shimron Hetmyer",   "batsman",    100.0, "Overseas", 0.79),
    ("p-liam-livingstone", "Liam Livingstone",  "all-rounder",100.0, "Overseas", 0.78),
    ("p-jason-holder",     "Jason Holder",      "all-rounder", 75.0, "Overseas", 0.75),
    ("p-adil-rashid",      "Adil Rashid",       "spinner",     75.0, "Overseas", 0.72),
    ("p-deep-dasgupta",    "D Dasgupta Jr",     "keeper",      50.0, "Indian",   0.38),  # cold-start
    ("p-local-talent-01",  "Unknown Talent 01", "batsman",     20.0, "Indian",   0.25),  # cold-start
    ("p-local-talent-02",  "Unknown Talent 02", "pacer",       20.0, "Indian",   0.30),  # cold-start
    ("p-varun-chakravarthy","Varun Chakravarthy","spinner",    100.0, "Indian",   0.82),
    ("p-mohit-sharma",     "Mohit Sharma",      "pacer",       50.0, "Indian",   0.74),
    ("p-devdutt-padikkal", "Devdutt Padikkal",  "batsman",     75.0, "Indian",   0.79),
    ("p-ruturaj-gaikwad",  "Ruturaj Gaikwad",   "batsman",    100.0, "Indian",   0.83),
    ("p-ishan-kishan",     "Ishan Kishan",      "keeper",     100.0, "Indian",   0.82),
    ("p-prithvi-shaw",     "Prithvi Shaw",      "batsman",     75.0, "Indian",   0.77),
    ("p-deepak-chahar",    "Deepak Chahar",     "pacer",       75.0, "Indian",   0.78),
    ("p-bhuvneshwar-kumar","Bhuvneshwar Kumar", "pacer",       75.0, "Indian",   0.80),
    ("p-rinku-singh",      "Rinku Singh",       "batsman",     50.0, "Indian",   0.76),
    ("p-tilak-varma",      "Tilak Varma",       "batsman",     50.0, "Indian",   0.75),
    ("p-shivam-dube",      "Shivam Dube",       "all-rounder", 50.0, "Indian",   0.73),
    ("p-sai-sudharsan",    "Sai Sudharsan",     "batsman",     50.0, "Indian",   0.74),
    ("p-riyan-parag",      "Riyan Parag",       "batsman",     50.0, "Indian",   0.72),
]


def _required_increment(current: float) -> float:
    for (up_to, inc) in INCREMENT_BANDS:
        if current < up_to:
            return inc
    return 25.0


def _generate_auction(seed: int, num_nominations: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    events: list[dict[str, Any]] = []
    seq = 0
    start_time = datetime(2026, 4, 19, 10, 0, 0, tzinfo=UTC)

    def _ts(offset_seconds: float) -> str:
        return (start_time + timedelta(seconds=offset_seconds)).isoformat()

    def _event(
        event_type: str,
        payload: dict[str, Any],
        agent_id: str | None = None,
        offset: float = 0.0,
    ) -> dict[str, Any]:
        nonlocal seq
        seq += 1
        return {
            "event_id": str(uuid.UUID(int=rng.getrandbits(128))),
            "auction_id": "550e8400-e29b-41d4-a716-446655440000",
            "seq": seq,
            "type": event_type,
            "payload": payload,
            "agent_id": agent_id,
            "timestamp": _ts(offset),
        }

    # --- auction.started ---
    events.append(_event("auction.started", {"seed": str(seed)}, offset=0.0))
    time_offset = 2.0

    # Team state tracking
    budgets: dict[str, float] = {a: INITIAL_BUDGET_CR * 100 for a in ALL_AGENTS}  # in lakhs
    squads: dict[str, list[dict[str, Any]]] = {a: [] for a in ALL_AGENTS}
    overseas_counts: dict[str, int] = {a: 0 for a in ALL_AGENTS}

    # Shuffle nomination order with seeded RNG
    player_pool = list(PLAYER_POOL[:num_nominations])
    rng.shuffle(player_pool)

    nominator_idx = 0

    for nomination_num, player in enumerate(player_pool, start=1):
        player_id, name, role, base_price, nationality, confidence = player
        is_cold_start = confidence < 0.5
        is_overseas = nationality == "Overseas"

        # --- player.nominated ---
        nominator_idx += 1
        events.append(
            _event(
                "player.nominated",
                {
                    "player_id": player_id,
                    "name": name,
                    "role": role,
                    "base_price_lakhs": base_price,
                    "nationality": nationality,
                    "is_cold_start": is_cold_start,
                    "nomination_seq": nomination_num,
                },
                offset=time_offset,
            )
        )
        time_offset += 1.0

        # --- Determine interested agents (those who can afford and have squad space) ---
        interested = [
            a for a in ALL_AGENTS
            if (budgets[a] >= base_price
                and len(squads[a]) < MAX_SQUAD
                and (not is_overseas or overseas_counts[a] < 8))
        ]
        if not interested:
            events.append(
                _event("player.unsold", {"player_id": player_id, "name": name}, offset=time_offset)
            )
            time_offset += 0.5
            continue

        # Sort by (budget ratio × confidence modifier) descending
        interested.sort(
            key=lambda a: budgets[a] / (INITIAL_BUDGET_CR * 100) * rng.uniform(0.8, 1.2),
            reverse=True,
        )

        # --- opening_bid ---
        current_bid = base_price
        current_bidder = interested[0]
        events.append(
            _event(
                "bid.placed",
                {
                    "player_id": player_id,
                    "bidder": current_bidder,
                    "amount_lakhs": current_bid,
                    "bid_type": "opening",
                },
                agent_id=current_bidder,
                offset=time_offset,
            )
        )
        time_offset += rng.uniform(1.0, 3.0)

        # --- bidding rounds (2–6 rounds) ---
        num_rounds = rng.randint(2, 6)
        active = interested[:2]  # two-bidder protocol
        for _ in range(num_rounds):
            # Next bidder in rotation
            next_bidder = [a for a in active if a != current_bidder]
            if not next_bidder:
                break
            challenger = next_bidder[0]
            increment = _required_increment(current_bid)
            new_bid = current_bid + increment

            # Challenger drops if budget insufficient or budget pressure too high
            budget_ratio = budgets[challenger] / (INITIAL_BUDGET_CR * 100)
            drop_probability = max(0.0, 0.6 - budget_ratio - confidence * 0.3)
            if new_bid > budgets[challenger] or rng.random() < drop_probability:
                events.append(
                    _event(
                        "bid.dropped",
                        {"player_id": player_id, "bidder": challenger},
                        agent_id=challenger,
                        offset=time_offset,
                    )
                )
                time_offset += rng.uniform(1.0, 2.0)
                break
            else:
                current_bid = new_bid
                current_bidder = challenger
                events.append(
                    _event(
                        "bid.placed",
                        {
                            "player_id": player_id,
                            "bidder": current_bidder,
                            "amount_lakhs": current_bid,
                            "bid_type": "raise",
                        },
                        agent_id=current_bidder,
                        offset=time_offset,
                    )
                )
                time_offset += rng.uniform(1.0, 3.5)

        # --- player.sold ---
        budgets[current_bidder] -= current_bid
        squads[current_bidder].append({
            "player_id": player_id,
            "name": name,
            "role": role,
            "price_lakhs": current_bid,
        })
        if is_overseas:
            overseas_counts[current_bidder] += 1

        events.append(
            _event(
                "player.sold",
                {
                    "player_id": player_id,
                    "name": name,
                    "winner": current_bidder,
                    "final_price_lakhs": current_bid,
                    "nomination_seq": nomination_num,
                },
                offset=time_offset,
            )
        )
        time_offset += 1.5

        # Periodic snapshot every 10 nominations
        if nomination_num % 10 == 0:
            events.append(
                _event(
                    "snapshot.taken",
                    {
                        "nomination_seq": nomination_num,
                        "budgets": {a: budgets[a] for a in ALL_AGENTS},
                        "squad_sizes": {a: len(squads[a]) for a in ALL_AGENTS},
                    },
                    offset=time_offset,
                )
            )
            time_offset += 0.5

    # --- auction.ended ---
    events.append(
        _event(
            "auction.ended",
            {
                "total_nominations": num_nominations,
                "sold_count": sum(1 for e in events if e["type"] == "player.sold"),
                "unsold_count": sum(1 for e in events if e["type"] == "player.unsold"),
            },
            offset=time_offset,
        )
    )

    return events


def main() -> None:
    events = _generate_auction(seed=SEED, num_nominations=NUM_NOMINATIONS)
    out_path = Path(__file__).parent / "golden_event_log.json"
    with out_path.open("w") as f:
        json.dump(events, f, indent=2)
    print(f"✓ Generated {len(events)} events → {out_path}")
    # Stats
    types: dict[str, int] = {}
    for e in events:
        types[e["type"]] = types.get(e["type"], 0) + 1
    for t, count in sorted(types.items()):
        print(f"  {t}: {count}")


if __name__ == "__main__":
    main()
