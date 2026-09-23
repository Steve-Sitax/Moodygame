import { describe, expect, it } from "vitest";
import { plainEnglish } from "../src/text.ts";

describe("plain English", () => {
  it.each([
    ["Eat, jongen, you look like a wet rope.", "Eat, you look like a wet rope."],
    ["The river keeps no books, jongen.", "The river keeps no books."],
    ["\"Not now, jongen.\"", "\"Not now.\""],
    ["Later, maat. The river is talking.", "Later. The river is talking."],
    ["\"Goed. Come back tomorrow.\"", "\"Come back tomorrow.\""],
    ["Ach, schat, I've herring to sell.", "I've herring to sell."],
    ["Jongen, listen to me.", "Listen to me."],
    ["The Hessenatie pays at the Rijnkaai, by the Schelde.", "The Hessenatie pays at the Rijnkaai, by the Schelde."],
    ["A nip of jenever, then.", "A nip of jenever, then."],
    ["He is a good man.", "He is a good man."],
  ])("%s", (a, b) => expect(plainEnglish(a)).toBe(b));
});
