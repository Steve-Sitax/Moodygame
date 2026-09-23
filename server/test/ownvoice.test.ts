import { describe, expect, it } from "vitest";
import { ownVoice } from "../src/town/rumours.ts";

// Steve: Rosalie said Jef stole a herring "from Rosalie's stall"; she should say "my stall".
describe("ownVoice", () => {
  const me = ["Rosalie Peeters", "Rosalie"];
  it("turns the speaker's own name into my, I and me", () => {
    expect(ownVoice("Jef stole a herring from Rosalie's stall, and Rosalie saw it.", me)).toBe("Jef stole a herring from my stall, and I saw it.");
    expect(ownVoice("Rosalie Peeters says you took it.", me)).toBe("I say you took it.");
    expect(ownVoice("He gave it back to Rosalie.", me)).toBe("He gave it back to me.");
    expect(ownVoice("Rosalie is angry.", me)).toBe("I am angry.");
  });
  it("leaves other people's names alone", () => {
    expect(ownVoice("Jef took Fientje's herring.", me)).toBe("Jef took Fientje's herring.");
    expect(ownVoice("Rosalind was there.", me)).toBe("Rosalind was there.");
  });
});
