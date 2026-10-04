import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { createTestRepository } from "../support/database.js";
import { ExecutionRepository } from "../../src/features/execution/execution.repo.js";
import { createCapability } from "../../src/shared/auth/auth.service.js";
import { readDatabaseConfig } from "../../src/shared/config/env.js";

const interpretation = {
  outcome: "ready",
  message: "",
  review: null,
  action: { kind: "transfer", network: "hedera", asset: "HBAR", amount: "1", recipient: "0.0.2" },
} as const;

test("database configuration requires one explicit mode and a matching URI", () => {
  assert.deepEqual(readDatabaseConfig({ DB_MODE: "mongodb", DB_URI: "mongodb://localhost:27017/9oob" }), {
    mode: "mongodb",
    uri: "mongodb://localhost:27017/9oob",
  });
  assert.deepEqual(readDatabaseConfig({ DB_MODE: "postgres", DB_URI: "postgresql://localhost/9oob" }), {
    mode: "postgres",
    uri: "postgresql://localhost/9oob",
  });
  for (const env of [
    {},
    { DB_MODE: "sqlite", DB_URI: "file:test" },
    { DB_MODE: "postgres" },
    { DB_MODE: "postgres", DB_URI: "mongodb://localhost/test" },
  ])
    assert.throws(() => readDatabaseConfig(env));
});

for (const mode of ["postgres", "mongodb"] as const) {
  test(`${mode} persists atomic preparation and submissions, isolates capabilities, and limits concurrent requests`, async () => {
    const directory = await mkdtemp(join(tmpdir(), `9oob-${mode}-`));
    let mongo: MongoMemoryServer | undefined;
    if (mode === "mongodb") {
      mongo = await MongoMemoryServer.create({
        instance: { launchTimeout: 60_000 },
        binary: {
          version: "7.0.14",
          downloadDir: process.env.MONGOMS_DOWNLOAD_DIR || join(tmpdir(), "9oob-mongodb-binaries"),
        },
      });
    }
    const open = () =>
      mode === "mongodb"
        ? Promise.resolve(ExecutionRepository.fromConfig({ mode, uri: mongo!.getUri("noob_test") }))
        : createTestRepository(join(directory, "data"));
    let repository = await open();
    const capability = createCapability();
    try {
      await repository.create({
        ...capability,
        intent: "Send 1 HBAR",
        accountId: "0.0.1",
        status: "approved",
        interpretation,
      });
      assert.equal(await repository.get(capability.id, "foreign-capability"), null);
      const context = { phase: "source", step: { kind: "hedera-transfer", amount: "100000000" } };
      const preparations = await Promise.all(
        Array.from({ length: 12 }, () => repository.commitPreparation(capability.id, capability.tokenHash, 0, context)),
      );
      assert.equal(preparations.filter(Boolean).length, 1);
      const prepared = preparations.find(Boolean)!;
      assert.equal(prepared.version, 1);
      assert.deepEqual(await repository.getContext(capability.id, capability.tokenHash), context);
      assert.equal(await repository.getContext(capability.id, "foreign-capability"), null);
      assert.equal(await repository.setContext(capability.id, "foreign-capability", {}), false);
      const hash = "0.0.1@1800000000.123456789";
      const submissions = await Promise.all(
        Array.from({ length: 12 }, () =>
          repository.recordSubmission(capability.id, capability.tokenHash, prepared.version, hash),
        ),
      );
      assert.equal(submissions.filter(Boolean).length, 1);
      assert.deepEqual(await repository.pending(), [{ id: capability.id, tokenHash: capability.tokenHash }]);
      const clarification = createCapability();
      await repository.create({
        ...clarification,
        intent: "Check my balance",
        accountId: null,
        status: "clarification_required",
        interpretation: { outcome: "clarification", action: null, review: null, message: "Which network?" },
      });
      const turns = [{ question: "Which asset?", answer: "ETH" }];
      const replies = await Promise.all(
        Array.from({ length: 4 }, () =>
          repository.transition(
            clarification.id,
            clarification.tokenHash,
            ["clarification_required"],
            { clarifications: turns },
            0,
          ),
        ),
      );
      assert.equal(replies.filter(Boolean).length, 1);
      await repository.close();
      repository = await open();
      assert.deepEqual((await repository.get(clarification.id, clarification.tokenHash))?.clarifications, turns);
      assert.equal((await repository.get(capability.id, capability.tokenHash))?.sourceTxHash, hash);
      assert.deepEqual(await repository.getContext(capability.id, capability.tokenHash), context);
      assert.equal(
        (await repository.submittedForVersion(capability.id, capability.tokenHash, prepared.version, hash))?.status,
        "submitted",
      );
      assert.equal(
        await repository.submittedForVersion(
          capability.id,
          capability.tokenHash,
          prepared.version,
          "another-reference",
        ),
        null,
      );
      assert.equal(await repository.commitPreparation(capability.id, capability.tokenHash, 2, context), null);
      const now = 1_800_000_000_000;
      const accepted = await Promise.all(
        Array.from({ length: 40 }, () => repository.consumeRateLimit("request-bucket", 12, 60, now)),
      );
      assert.equal(accepted.filter(Boolean).length, 12);
      assert.equal(await repository.consumeRateLimit("request-bucket", 12, 60, now + 1_000), false);
      assert.equal(await repository.consumeRateLimit("request-bucket", 12, 60, now + 60_000), true);
      await repository.transition(capability.id, capability.tokenHash, ["submitted"], { status: "completed" });
      assert.deepEqual(await repository.pending(), []);
    } finally {
      await repository.close();
      await mongo?.stop();
      await rm(directory, { recursive: true, force: true });
    }
  });
}
