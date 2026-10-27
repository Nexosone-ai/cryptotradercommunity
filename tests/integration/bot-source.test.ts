import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db/client";
import { botSources, bots } from "@/lib/db/schema";
import type { StoredBotConfig } from "@/lib/bots/schema";
import { createBot, getBotSource, ownerSetStatus, reviewBot, submitBot, updateBot } from "@/lib/bots/service";
import { makeUser, testDb, validBotInput } from "../helpers/db";

const PINE = readFileSync(path.join(__dirname, "../fixtures/rsi-div-ltf-delta.pine"), "utf8");

describe("bot strategy source code", () => {
  let db: Db;
  beforeAll(async () => {
    db = await testDb();
  });

  it("stores the code separately; config keeps only metadata and hash", async () => {
    const owner = await makeUser(db);
    const { bot } = await createBot(db, owner, validBotInput({ source: { language: "PINESCRIPT", visibility: "PRIVATE", code: PINE } }));
    const cfg = bot.config as StoredBotConfig & { source: { code?: string } };
    expect(cfg.source).toMatchObject({ language: "PINESCRIPT", visibility: "PRIVATE", pine: { version: 6, kind: "indicator", alerts: 2 } });
    expect(cfg.source.code).toBeUndefined();
    expect(cfg.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    const rows = await db.select().from(botSources).where(eq(botSources.botId, bot.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].sha256).toBe(cfg.source.sha256);
  });

  it("PRIVATE source: owner and admins see the code, others only the metadata", async () => {
    const owner = await makeUser(db);
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const visitor = await makeUser(db);
    const { bot } = await createBot(db, owner, validBotInput({ source: { language: "PINESCRIPT", visibility: "PRIVATE", code: PINE } }));
    expect((await getBotSource(db, bot, owner))?.code).toContain("RSI DIV + LTF DELTA");
    expect((await getBotSource(db, bot, admin))?.code).toContain("RSI DIV + LTF DELTA");
    const forVisitor = await getBotSource(db, bot, visitor);
    expect(forVisitor?.code).toBeNull();
    expect(forVisitor?.meta.pine?.title).toBe("RSI DIV + LTF DELTA + EMA FILTER V11");
    expect((await getBotSource(db, bot, null))?.code).toBeNull();
  });

  it("PUBLIC source is visible to everyone", async () => {
    const owner = await makeUser(db);
    const { bot } = await createBot(db, owner, validBotInput({ source: { language: "PINESCRIPT", visibility: "PUBLIC", code: PINE } }));
    expect((await getBotSource(db, bot, null))?.code).toContain("alertcondition");
  });

  it("changing the code of a live bot sends it back to review; re-saving identical code (CRLF) does not", async () => {
    const owner = await makeUser(db);
    const admin = await makeUser(db, ["TRADER", "ADMIN"]);
    const src = { language: "PINESCRIPT", visibility: "PRIVATE", code: PINE };
    const input = validBotInput({ source: src });
    const { bot } = await createBot(db, owner, input);
    await submitBot(db, owner, bot.id);
    await reviewBot(db, admin, bot.id, "APPROVE");
    await ownerSetStatus(db, owner, bot.id, "LIVE");

    const same = await updateBot(db, owner, bot.id, { ...input, source: { ...src, code: PINE.replace(/\n/g, "\r\n") } });
    expect(same.changed).toBe(false);

    const edited = PINE.replace("rsiLen = input.int(14", "rsiLen = input.int(21");
    const r = await updateBot(db, owner, bot.id, { ...input, source: { ...src, code: edited } });
    expect(r.bot.status).toBe("SUBMITTED");
    expect(await db.select().from(botSources).where(eq(botSources.botId, bot.id))).toHaveLength(2);
    const [row] = await db.select().from(bots).where(eq(bots.id, bot.id));
    expect((await getBotSource(db, row, owner))?.code).toContain("input.int(21");
  });

  it("refuses code with secrets", async () => {
    const owner = await makeUser(db);
    const code = `//@version=6\nindicator("x")\n// key: 0x${"cd".repeat(32)}\nplot(close)\n`;
    await expect(createBot(db, owner, validBotInput({ source: { language: "PINESCRIPT", code } }))).rejects.toThrow(/비밀값/);
  });
});
