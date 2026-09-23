# 07 - Spike results, 2026-09-23

What was tested: can the local Claude login drive Opus 5.5 with JSON output, at game quality and game speed.
Tool: the `claude` CLI 2.1.280, print mode. The Agent SDK wraps the same binary with the same options.
Machine: this PC. No API key set. Login via the Claude subscription.

## 1. Smoke test
```
claude -p "Reply with exactly: PONG" --model claude-opus-5-5 --output-format json
```
Result: ok. API time 2.5 s. Base prompt 32k tokens (17k created, 15k read from cache).

## 2. Job board entry, medium effort, JSON schema
Flags: `--effort medium --tools "" --json-schema <job schema>`
Output:
```json
{
 "title": "Lantern Watch on the Rijnkaai",
 "employer": "Widow Peeters, chandler",
 "district": "Het Eilandje",
 "pay_centimes": 150,
 "risk": "low",
 "pitch": "Fog rolls thick off the Scheldt tonight. The widow's lamp-oil barrels wait on the quay, and someone keeps prying at the lids. Keep watch till the bells ring six. Just watch. Don't play the hero.",
 "required_trust": 2
}
```
API 6.0 s, wall 7.3 s. 409 output tokens, 111 thinking. Cold cache: 47k tokens created, cost 0.39 USD at list.
Quality: right district names, right period, right tone. Pay fits tier 0.

## 3. Dialogue with memory, medium effort, custom system prompt
Flags: `--system-prompt <voice rules> --tools "" --no-session-persistence --json-schema <dialogue schema>`
Input had a MEMORY block: purse returned yesterday, barrel lost on watch today.
Output:
```json
{
 "npc_line": "Dawn, Jef. One barrel short on the Rijnkaai, and it went on your lantern. The Hessenatie pays for every stave that walks. Now, I hear you gave the Widow Peeters her purse back yesterday. So I'll hear you out before I judge. Spreek. What did you see?",
 "mood": "cold",
 "choices": [
  "I saw nothing, baas. I'll not lie to you. It went on my watch, and I'll work it off.",
  "There was a lighter near the Kraanhoofd past midnight. No lamp on her. I'd know the man again.",
  "I've forty centimes to my name and an empty belly. Take it from my wage, but let me keep the work."
 ],
 "trust_delta": -1,
 "memory_note": "Dawn on the Rijnkaai: Sooi confronted Jef about the missing barrel..."
}
```
API 8.1 s, wall 9.3 s. Cold cache 46k created, 0.38 USD at list.
Quality: both memory facts used. Flemish words placed well. Choices are real choices.

## 4. Rumour, low effort, leanest flags, run twice
Flags added: `--disable-slash-commands --setting-sources "" --exclude-dynamic-system-prompt-sections`
Run 1: API 2.9 s, cache read 42k, created 1.5k, cost 0.022 USD.
Run 2: API 2.9 s, cache read 43.5k, created 0, cost 0.011 USD.
Output run 2: "Jef of the Kattendijkdok? Slept on his lantern watch, he did. A whole barrel of genever walked off, and now his breath smells suspiciously sweet!"

## What this means
- Local Claude with Opus 5.5 works for the game. No API key needed.
- The base prompt stays about 42k tokens even with the lean flags. It is cached. Warm calls cost about 1 to 2 cents at list.
- Budget 4 to 9 seconds per call. The game must prefetch and never block.
- JSON schema output is reliable. Use it on every hook.
- A custom system prompt and `tools: []` are enough. No file access, no bash.

## 5. Codex CLI with gpt-6-sol (approved by Steve, same two prompts as tests 3 and 4)
Flags: `codex exec -C <empty dir> --skip-git-repo-check --ephemeral -s read-only -m gpt-6-sol -c 'model_reasoning_effort="medium"' --json --output-schema <file> -o <file> "<prompt>" < /dev/null`

Rumour, low effort: wall 7.8 s. Input 15.6k tokens (12.2k cached), output 27.
Output: "Jef says a barrel rolled off during his lantern watch, but I saw him counting coins behind the fish stalls."

Dialogue, medium effort, JSON schema: wall 9.0 s. Input 15.6k, output 152, reasoning 37. Schema valid.
```json
{"npc_line":"Morning, Jef. Widow Peeters says you returned her purse. Goed. Now tell me how a barrel vanished while you held the lantern on the Rijnkaai.","mood":"neutral","choices":["I saw no one take it, baas.","Let me search the quay.","Dock my pay if I failed you."],"trust_delta":0,"memory_note":"Sooi knows Jef returned Widow Peeters's purse yesterday and that one barrel went missing during Jef's lantern watch."}
```
Events showed only `agent_message`. No shell command was run.

Compare with Claude (test 3): Claude's Sooi is richer and the choices carry more weight. GPT-6 sol is terser and flatter, but fast and correct. Fits the plan: Claude for dialogue and jobs, GPT-6 sol for rumours, newspaper, event seeds.

Gotchas found:
- The first dialogue run hung for 180 s. Codex waits on stdin when stdin is a pipe. Always close stdin (`< /dev/null`, or `stdio: ['ignore', ...]` from Node).
- Steve's `~/.codex/config.toml` has `sandbox_mode = "danger-full-access"` and a `notify` hook. The game must pass `-s read-only` on every call, and should pass `--ignore-user-config` so the hook and the default sandbox never apply. Model and effort then come from our flags.
- Codex base prompt is about 15.6k tokens. Cache hits are not guaranteed (second run showed 0 cached).

## Not tested
- The Agent SDK from Node itself. Same binary, so low risk. First real test is milestone M2.
- Rate limits over a 40-minute session. Watch in M5 playtests.
