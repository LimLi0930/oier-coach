"""OIerDB DB score, adapted from generator/util.py at the pinned commit.

Copyright OIerDB contributors. AGPL-3.0. See THIRD_PARTY.md.
"""
from decimal import Decimal, getcontext

getcontext().prec = 64
SCORING_VERSION = 'oierdb-e104eb6-coach-v3'
WEIGHTS = {name: Decimal(value) for name, value in {
    'NOI': '.7', 'WC': '.5', 'APIO': '.4', 'IOI': '1',
    'NOID类': '.7',
    'NOIP': '.15', 'NOIP提高': '.1', 'NOIP普及': '.06',
}.items()}
RANK_COEFFICIENTS = (
    [Decimal(i) for i in range(100, 39, -1)]
    + [Decimal('.15') * i for i in range(239, 50, -1)]
    + [Decimal('.05') * i for i in range(150, -1, -1)]
)


def rank_coefficient(rank: int, total: int) -> Decimal:
    if total <= 0:
        raise ValueError('Contest population must be positive')
    return RANK_COEFFICIENTS[400 * max(min(rank, total), 1) // total]


def contribution(year: int, rank: int, total: int, contest_type: str) -> Decimal:
    return Decimal('1.25') ** (year - 2000) * rank_coefficient(rank, total) * WEIGHTS[contest_type]


def competition_ranks(scores: dict) -> dict:
    ordered = sorted(scores, key=lambda key: (-scores[key], key))
    ranks, previous, rank = {}, None, 0
    for position, key in enumerate(ordered, 1):
        if scores[key] != previous:
            rank = position
        ranks[key] = rank
        previous = scores[key]
    return ranks
