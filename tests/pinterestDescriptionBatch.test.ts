import assert from "node:assert/strict";
import test from "node:test";
import { generatePinterestDescriptionsWithAI, parsePinterestDescriptionBatch } from "../lib/pinterest/aiDescription";
import { generateMissingPinterestDescriptions, type DescriptionTarget, type DescriptionDraft } from "../lib/services/generatePinterestDescriptions";

const item = (id: number): DescriptionTarget => ({ id: String(id), title: `Shirt ${id}`, description: "Original Etsy text.", pin_description: null, status: "pending", updated_at: "2026-09-14T12:00:00Z" });
const generate = async (products: { id: string }[]) => new Map(products.map(p => [p.id, `A description for ${p.id}.`]));

test("batch AI schema requires exact IDs and rejects incomplete, foreign or long results", async () => {
  for (const descriptions of [[], {}, { "2": "a" }, { "1": "a".repeat(501) }]) {
    assert.throws(() => parsePinterestDescriptionBatch({ descriptions }, ["1"]));
  }
  const result = await generatePinterestDescriptionsWithAI({ apiKey: "test", model: "test", products: [item(1)], fetchImpl: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.store, false);
    assert.deepEqual(body.text.format.schema.properties.descriptions.required, ["1"]);
    assert.equal(body.text.format.schema.properties.descriptions.additionalProperties, false);
    assert.equal(JSON.parse(body.input[1].content)[0].id, "1");
    return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ descriptions: { "1": "A shirt description." } }) }] }] });
  } });
  assert.equal(result.get("1"), "A shirt description.");
});

test("bulk saves in bounded batches, checkpoints first, and preserves published and edited descriptions", async () => {
  const checked = new Set<string>();
  const saved: string[] = [];
  const items = Array.from({ length: 24 }, (_, i) => item(i));
  items[0].status = "published";
  items[1].pin_description = "Manual edit";
  items[2].status = "processing";
  const result = await generateMissingPinterestDescriptions({ items, concurrency: 3,
    generate: async products => { assert.ok(products.length <= 10); return generate(products); },
    checkpoint: async drafts => { drafts.forEach(d => checked.add(d.id)); },
    save: async draft => { assert.ok(checked.has(draft.id)); saved.push(draft.id); return draft.id !== "3"; }
  });
  assert.deepEqual(result, { selected: 21, saved: 20, skipped: 1 });
  assert.equal(new Set(saved).size, 21);
  assert.ok(!saved.includes("0") && !saved.includes("1") && !saved.includes("2"));
});

test("an interrupted DB save resumes from checkpoint without another AI request", async () => {
  const drafts = new Map<string, DescriptionDraft>();
  let calls = 0;
  const options = { items: [item(1)], drafts,
    generate: async (products: { id: string }[]) => { calls++; return generate(products); },
    checkpoint: async (batch: DescriptionDraft[]) => { batch.forEach(d => drafts.set(d.id, d)); }
  };
  await assert.rejects(generateMissingPinterestDescriptions({ ...options, save: async () => { throw new Error("DB offline"); } }), /DB offline/);
  assert.equal((await generateMissingPinterestDescriptions({ ...options, save: async () => true })).saved, 1);
  assert.equal(calls, 1);
  options.items[0].updated_at = "new version";
  await generateMissingPinterestDescriptions({ ...options, save: async () => true });
  assert.equal(calls, 2);
});

test("AI failure writes nothing and stops before starting more batches", async () => {
  let calls = 0;
  await assert.rejects(generateMissingPinterestDescriptions({ items: Array.from({ length: 30 }, (_, i) => item(i)),
    generate: async () => { calls++; throw new Error("AI unavailable"); },
    checkpoint: async () => { assert.fail("No draft expected"); },
    save: async () => { assert.fail("No save expected"); }
  }), /AI unavailable/);
  assert.equal(calls, 1);
});
