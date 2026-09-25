import assert from "node:assert/strict";
import test from "node:test";
import { isWithinCronCadence } from "../lib/services/cronCadence";

const now = Date.parse("2026-09-22T10:00:00.000Z");

test("cron cadence blocks duplicate deliveries inside the configured interval", () => {
  assert.equal(isWithinCronCadence("2026-09-22T09:42:00.000Z", 20, now), true);
  assert.equal(isWithinCronCadence("2026-09-22T09:41:30.000Z", 20, now), false);
  assert.equal(isWithinCronCadence(null, 20, now), false);
  assert.equal(isWithinCronCadence("invalid", 20, now), false);
});

test("cron cadence allows the next scheduled delivery despite normal scheduler jitter", () => {
  assert.equal(isWithinCronCadence("2026-09-22T09:45:30.000Z", 15, now), false);
  assert.equal(isWithinCronCadence("2026-09-22T09:46:31.000Z", 15, now), true);
});
