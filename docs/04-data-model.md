# 04 - Data model (SQLite)

One file: `data/game.sqlite`. One save slot for the demo. Delete the file to start over.

## player
| column | type | note |
|---|---|---|
| id | int | always 1 |
| name | text | Jef |
| money_c | int | centimes |
| food, warmth, health, sleep | int | 0-10 |
| day | int | 1-7 |
| hour | int | 0-23 |
| district | text | current area id |
| rent_paid_until | int | day |

## faction_trust
| faction | text | naties, kerk, politie, smokkelaars, burgerij |
| trust | int | 0-10 |

## npc
| id | text | sooi, peeters, fientje, ... |
| name, role, district, faction | text | |
| persona_json | text | traits, wants, fears, secret, speech. See 03. |
| spot_id | text | where they stand now |
| active | int | 0/1, world ops can hide them |

## npc_relationship
| npc_id | text | |
| trust, affection, respect, fear | int | 0-10 |
| times_met | int | |
| last_seen_day, last_place | | |
| favours_json, grudges_json | text | short lists with day and weight |
| view_of_player | text | one line, in the NPC's words |

## npc_memory
| id | int | |
| npc_id | text | |
| text | text | one sentence |
| source | text | seen, heard |
| heard_from | text | npc id or null |
| weight | int | 1-10 |
| day | int | when formed |

## world_fact
| id | int | |
| text | text | |
| weight | int | 1-10 |
| day | int | |
| tags | text | comma list: district, faction, npc ids |

## log
| id | int | append only |
| day, hour | int | |
| place | text | |
| actor | text | player, npc id, world |
| verb | text | took_job, finished_job, said, paid, stole, helped, event, ... |
| object | text | |
| text | text | one line for humans |

## job
| id | int | |
| day | int | board day |
| title, employer_npc, district, task_type | text | |
| pay_c | int | |
| risk | text | low, medium, high |
| tier, required_faction | | |
| pitch | text | |
| status | text | offered, taken, done, failed, expired |
| outcome_text | text | |

## event
| id | int | |
| day, slot | | night, dawn, on_job |
| text | text | |
| ops_json | text | world ops applied |
| status | text | pending, fired |

## world_state
| key | text | weather, closed_areas, price_factors, lamps, flags |
| value_json | text | |

## ai_call
| id | int | |
| day, hour | | game time |
| hook | text | |
| provider | text | claude, codex |
| model | text | |
| ms | int | |
| in_tokens, out_tokens, cache_read | int | |
| ok | int | 0/1 |
| error | text | |

Rules:
- Only the server writes. The client reads through the API.
- Every model output is written to `log` and `ai_call` before it is applied.
- Weights decay at consolidate: world_fact and npc_memory weight -1 per day, floor 1. Rows at weight 1 for 3 days are deleted.
