CREATE TABLE ai_call (
  id INTEGER PRIMARY KEY,
  day INTEGER, hour INTEGER,
  hook TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  ms INTEGER NOT NULL,
  in_tokens INTEGER, out_tokens INTEGER, cache_read INTEGER,
  ok INTEGER NOT NULL,
  error TEXT
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE client_state (
  player_id INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);

CREATE TABLE diary (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  day INTEGER NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  entries_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'engine',
  status TEXT NOT NULL CHECK (status IN ('writing', 'lying', 'held', 'returned', 'sold', 'squeezed', 'gone')),
  read INTEGER NOT NULL DEFAULT 0,
  closed_day INTEGER,
  started_min INTEGER,
  tries INTEGER NOT NULL DEFAULT 0
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE event (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, slot TEXT NOT NULL,
  text TEXT NOT NULL, ops_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending','fired'))
);

CREATE TABLE faction_trust (
  player_id INTEGER NOT NULL DEFAULT 1,
  faction TEXT NOT NULL,
  trust INTEGER NOT NULL CHECK (trust BETWEEN -5 AND 10),
  PRIMARY KEY (player_id, faction)
);

CREATE TABLE family_news (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  teller TEXT NOT NULL,
  listener TEXT NOT NULL,
  memory_id INTEGER NOT NULL,
  origin INTEGER NOT NULL,
  gist TEXT NOT NULL,
  tone INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'heard', 'pending', 'acting', 'done', 'lapsed')),
  reaction TEXT,
  amount_c INTEGER NOT NULL DEFAULT 0,
  opening TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  outcome TEXT,
  action_id INTEGER,
  not_before INTEGER NOT NULL DEFAULT 0
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE game_setting (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE home_item (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pocket','arms','stored','placed','gone')),
  home TEXT,
  gx INTEGER, gz INTEGER, rot INTEGER NOT NULL DEFAULT 0,
  day INTEGER NOT NULL
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE home_lease (
  id INTEGER PRIMARY KEY,
  home TEXT NOT NULL,
  since_day INTEGER NOT NULL,
  paid_through INTEGER NOT NULL,
  warned_day INTEGER NOT NULL DEFAULT 0,
  ended TEXT
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE item (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  job_id INTEGER
, ref INTEGER, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE jef_letter (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  to_id TEXT NOT NULL,
  to_name TEXT NOT NULL,
  text TEXT NOT NULL,
  gated TEXT,
  stamp_c INTEGER NOT NULL,
  reply_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'answered')),
  effect_json TEXT NOT NULL DEFAULT '{}',
  reply_letter INTEGER
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE job (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  title TEXT NOT NULL, employer_npc TEXT NOT NULL, district TEXT NOT NULL, task_type TEXT NOT NULL,
  pay_c INTEGER NOT NULL,
  risk TEXT NOT NULL,
  tier INTEGER NOT NULL, required_faction TEXT,
  pitch TEXT NOT NULL,
  task_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'claude',
  status TEXT NOT NULL CHECK (status IN ('offered','taken','done','failed','expired')),
  outcome_text TEXT
, taken_by INTEGER);

CREATE TABLE job_trouble (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  after_s INTEGER NOT NULL,
  cast_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL DEFAULT '[]',
  words_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'engine',
  status TEXT NOT NULL CHECK (status IN ('ready', 'chosen', 'settled')),
  choice INTEGER,
  step_done INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE letter (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  why TEXT NOT NULL,
  kind TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  offer_json TEXT NOT NULL DEFAULT '{}',
  text_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'engine',
  status TEXT NOT NULL CHECK (status IN ('writing', 'waiting', 'given', 'read')),
  job_id INTEGER
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE log (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  place TEXT NOT NULL, actor TEXT NOT NULL, verb TEXT NOT NULL, object TEXT,
  text TEXT NOT NULL
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE meeting (
  id INTEGER PRIMARY KEY,
  who TEXT NOT NULL,
  day INTEGER NOT NULL,
  from_h REAL NOT NULL, to_h REAL NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'met', 'missed')),
  letter INTEGER
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE mp_player (
  id INTEGER PRIMARY KEY CHECK (id >= 2),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  admin INTEGER NOT NULL DEFAULT 0,
  pose_json TEXT,
  created_at TEXT NOT NULL,
  seen_at TEXT
);

CREATE TABLE news_abroad (
  day INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  talk TEXT NOT NULL,
  prices_json TEXT NOT NULL,
  until_day INTEGER NOT NULL
);

CREATE TABLE newspaper (
  day INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price_c INTEGER NOT NULL,
  facts_json TEXT NOT NULL,
  paper_json TEXT NOT NULL,
  source TEXT NOT NULL,
  error TEXT
);

CREATE TABLE npc (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, role TEXT NOT NULL, district TEXT NOT NULL, faction TEXT,
  persona_json TEXT NOT NULL DEFAULT '{}',
  spot_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE npc_action (
  id INTEGER PRIMARY KEY,
  npc_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  target_x REAL, target_z REAL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('talk', 'director', 'event', 'engine')),
  event_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'done', 'failed', 'stopped', 'refused')),
  started INTEGER NOT NULL,
  until INTEGER NOT NULL,
  max_m INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'going',
  x REAL, z REAL,
  outcome TEXT,
  data_json TEXT NOT NULL DEFAULT '{}'
, for_player INTEGER);

CREATE TABLE npc_memory (
  id INTEGER PRIMARY KEY,
  npc_id TEXT NOT NULL REFERENCES npc(id),
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seen','heard')),
  heard_from TEXT,
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
  day INTEGER NOT NULL,
  spread INTEGER NOT NULL DEFAULT 0
, gist TEXT, tone INTEGER NOT NULL DEFAULT 0, origin INTEGER, town_spread INTEGER NOT NULL DEFAULT 0, told_as TEXT, about_player INTEGER);

CREATE TABLE npc_relationship (
  npc_id TEXT NOT NULL REFERENCES npc(id),
  player_id INTEGER NOT NULL DEFAULT 1,
  trust INTEGER NOT NULL DEFAULT 0, affection INTEGER NOT NULL DEFAULT 0,
  respect INTEGER NOT NULL DEFAULT 0, fear INTEGER NOT NULL DEFAULT 0,
  times_met INTEGER NOT NULL DEFAULT 0,
  last_seen_day INTEGER, last_place TEXT,
  favours_json TEXT NOT NULL DEFAULT '[]', grudges_json TEXT NOT NULL DEFAULT '[]',
  view_of_player TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (npc_id, player_id)
);

CREATE TABLE pawn (
  id INTEGER PRIMARY KEY,
  item_kind TEXT NOT NULL,
  item_name TEXT NOT NULL,
  worth_c INTEGER NOT NULL,
  loan_c INTEGER NOT NULL,
  rate_c INTEGER NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held', 'redeemed', 'forfeit')),
  paid_c INTEGER,
  closed_day INTEGER
, player_id INTEGER NOT NULL DEFAULT 1);

CREATE TABLE player (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  money_c INTEGER NOT NULL,
  food INTEGER NOT NULL, warmth INTEGER NOT NULL, health INTEGER NOT NULL, sleep INTEGER NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  district TEXT NOT NULL,
  rent_paid_until INTEGER NOT NULL
, minute INTEGER NOT NULL DEFAULT 0);

CREATE TABLE player_profile (
  player_id INTEGER PRIMARY KEY,
  profile_json TEXT NOT NULL,
  code TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE player_state (
  player_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (player_id, key)
);

CREATE TABLE poster (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  spot TEXT NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  down_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up', 'down')),
  why_down TEXT,
  ref TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  text_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'engine',
  names_jef INTEGER NOT NULL DEFAULT 0,
  reward_c INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  thing_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE resident (
  id TEXT PRIMARY KEY REFERENCES npc(id),
  household INTEGER NOT NULL,
  trade TEXT NOT NULL,
  data_json TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT ''
);

CREATE TABLE town_event (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  title TEXT NOT NULL,
  template TEXT NOT NULL,
  place TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, r REAL NOT NULL,
  start_m INTEGER NOT NULL, end_m INTEGER NOT NULL,
  stage INTEGER NOT NULL DEFAULT -1,
  stages_json TEXT NOT NULL,
  people_json TEXT NOT NULL DEFAULT '[]',
  leads_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'done', 'cancelled')),
  source TEXT NOT NULL,
  notice TEXT NOT NULL DEFAULT '',
  rumour TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT ''
, for_player INTEGER);

CREATE TABLE town_scheme (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  hour REAL NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'done', 'failed')),
  outcome TEXT,
  jef_helped INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE world_event (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL, minute INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  verb TEXT NOT NULL,
  actor TEXT, target TEXT, place TEXT,
  x REAL, z REAL,
  text TEXT NOT NULL,
  outcome TEXT,
  ref_type TEXT, ref_id INTEGER,
  weight INTEGER NOT NULL DEFAULT 2,
  data_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE world_event_who (
  event_id INTEGER NOT NULL REFERENCES world_event(id),
  who TEXT NOT NULL
);

CREATE TABLE world_fact (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
  day INTEGER NOT NULL,
  tags TEXT NOT NULL DEFAULT ''
);

CREATE TABLE world_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE INDEX ai_call_day_hook ON ai_call (day, hook);

CREATE INDEX family_news_status ON family_news(status);

CREATE INDEX npc_action_status ON npc_action(status, npc_id);

CREATE INDEX resident_household ON resident(household);

CREATE INDEX world_event_day ON world_event(day, hour);

CREATE INDEX world_event_who_who ON world_event_who(who);

CREATE TRIGGER world_clock_follow AFTER UPDATE OF day, hour, minute ON player WHEN NEW.id = 1
BEGIN
  INSERT OR REPLACE INTO world_state (key, value_json) VALUES ('clock', json_object('day', NEW.day, 'hour', NEW.hour, 'minute', NEW.minute));
END;

CREATE TRIGGER world_clock_seed AFTER INSERT ON player WHEN NEW.id = 1
BEGIN
  INSERT OR REPLACE INTO world_state (key, value_json) VALUES ('clock', json_object('day', NEW.day, 'hour', NEW.hour, 'minute', NEW.minute));
END;

CREATE TRIGGER world_event_from_log AFTER INSERT ON log BEGIN
  INSERT INTO world_event (day, hour, minute, kind, verb, actor, target, place, text, ref_type, ref_id, weight)
  VALUES (
    NEW.day, NEW.hour, COALESCE((SELECT minute FROM player WHERE id = 1), 0),
    CASE
      WHEN NEW.verb IN ('robbed', 'caught_thief', 'stole', 'gave_back', 'wrecked_boat') THEN 'theft'
      WHEN NEW.verb IN ('took_job', 'finished_job', 'failed_job', 'job_outcome', 'abandoned_job', 'job_board') THEN 'job'
      WHEN NEW.verb IN ('police_called', 'police_sent', 'fled_police', 'police_warning', 'police_fine', 'arrested', 'cell', 'restitution') THEN 'police'
      WHEN NEW.verb IN ('said_strange', 'talked') THEN 'talk'
      WHEN NEW.verb IN ('took_goods') THEN 'deed'
      ELSE 'log'
    END,
    NEW.verb, NEW.actor, NEW.object, NEW.place, NEW.text, 'log', NEW.id,
    CASE
      WHEN NEW.verb IN ('arrested', 'collapsed', 'week_over') THEN 9
      WHEN NEW.verb IN ('cell', 'wrecked_boat') THEN 8
      WHEN NEW.verb IN ('robbed', 'fled_police', 'police_fine', 'caught_thief') THEN 7
      WHEN NEW.verb IN ('stole', 'police_warning', 'took_goods', 'restitution', 'caught_thief') THEN 6
      WHEN NEW.verb IN ('finished_job', 'failed_job', 'abandoned_job', 'police_called') THEN 5
      WHEN NEW.verb IN ('job_outcome', 'police_sent', 'gave_back') THEN 4
      WHEN NEW.verb IN ('took_job', 'said_strange', 'slept_rough', 'job_board') THEN 3
      ELSE 2
    END
  );
  INSERT INTO world_event_who (event_id, who)
    SELECT (SELECT MAX(id) FROM world_event), NEW.actor WHERE NEW.actor IN (SELECT id FROM npc);
  INSERT INTO world_event_who (event_id, who)
    SELECT (SELECT MAX(id) FROM world_event), NEW.object WHERE NEW.object IN (SELECT id FROM npc) AND NEW.object IS NOT NEW.actor;
END;

CREATE TRIGGER world_event_from_rumour AFTER INSERT ON npc_memory
WHEN NEW.gist IS NOT NULL AND NEW.gist <> '' AND NEW.source = 'seen' BEGIN
  INSERT INTO world_event (day, hour, minute, kind, verb, actor, text, ref_type, ref_id, weight)
  VALUES (
    NEW.day, COALESCE((SELECT hour FROM player WHERE id = 1), 0), COALESCE((SELECT minute FROM player WHERE id = 1), 0),
    'rumour', 'rumour', NEW.npc_id, NEW.gist, 'memory', NEW.id, MAX(1, MIN(10, NEW.weight))
  );
  INSERT INTO world_event_who (event_id, who) VALUES ((SELECT MAX(id) FROM world_event), NEW.npc_id);
END;
