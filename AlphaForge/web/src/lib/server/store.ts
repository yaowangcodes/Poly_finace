import "server-only";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  paginateQuery,
} from "@aws-sdk/lib-dynamodb";
export class Conflict extends Error {}
export interface Row<T> {
  value: T;
  version: number;
}
export interface Store {
  get<T>(owner: string, id: string): Promise<Row<T> | null>;
  list<T>(owner: string): Promise<Row<T>[]>;
  put<T>(
    owner: string,
    id: string,
    value: T,
    expected: number | null,
    ttl?: number,
  ): Promise<number>;
  delete(owner: string, id: string, expected: number): Promise<void>;
}
function sizeCheck(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value)) > 300_000)
    throw new Error(
      "Conversation storage limit reached. Start a new conversation.",
    );
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export class FileStore implements Store {
  constructor(private root: string) {}
  private dir(owner: string) {
    return path.join(this.root, digest(owner));
  }
  private file(owner: string, id: string) {
    return path.join(this.dir(owner), `${digest(id)}.json`);
  }
  async get<T>(owner: string, id: string): Promise<Row<T> | null> {
    try {
      return JSON.parse(await readFile(this.file(owner, id), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  async list<T>(owner: string): Promise<Row<T>[]> {
    let files: string[];
    try {
      files = await readdir(this.dir(owner));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const rows = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          try {
            return JSON.parse(
              await readFile(path.join(this.dir(owner), f), "utf8"),
            ) as Row<T>;
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
            throw e;
          }
        }),
    );
    return rows.filter((r): r is Row<T> => r !== null);
  }
  private async locked<T>(owner: string, action: () => Promise<T>) {
    await mkdir(this.dir(owner), { recursive: true, mode: 0o700 });
    const release = await lockfile.lock(this.dir(owner), {
      retries: { retries: 10, minTimeout: 20, maxTimeout: 100 },
    });
    try {
      return await action();
    } finally {
      await release();
    }
  }
  async put<T>(owner: string, id: string, value: T, expected: number | null) {
    sizeCheck(value);
    return this.locked(owner, async () => {
      const existing = await this.get(owner, id);
      if ((existing?.version ?? null) !== expected)
        throw new Conflict("Conversation changed; refresh it.");
      const version = (expected ?? -1) + 1;
      const file = this.file(owner, id),
        temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ version, value }), {
        mode: 0o600,
      });
      await rename(temp, file);
      return version;
    });
  }
  async delete(owner: string, id: string, expected: number) {
    await this.locked(owner, async () => {
      const row = await this.get(owner, id);
      if (row?.version !== expected)
        throw new Conflict("Conversation changed.");
      await unlink(this.file(owner, id));
    });
  }
}
export class DynamoStore implements Store {
  constructor(
    private table: string,
    private client = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION }),
      { marshallOptions: { removeUndefinedValues: true } },
    ),
  ) {}
  async get<T>(owner: string, id: string): Promise<Row<T> | null> {
    const { Item } = await this.client.send(
      new GetCommand({
        TableName: this.table,
        Key: { pk: owner, sk: id },
        ConsistentRead: true,
      }),
    );
    return Item
      ? { value: JSON.parse(Item.data), version: Item.version }
      : null;
  }
  async list<T>(owner: string) {
    const result: Row<T>[] = [];
    for await (const page of paginateQuery(
      { client: this.client },
      {
        TableName: this.table,
        KeyConditionExpression: "pk = :owner",
        ExpressionAttributeValues: { ":owner": owner },
        ConsistentRead: true,
      },
    ))
      for (const item of page.Items ?? [])
        result.push({ value: JSON.parse(item.data), version: item.version });
    return result;
  }
  async put<T>(
    owner: string,
    id: string,
    value: T,
    expected: number | null,
    ttl?: number,
  ) {
    sizeCheck(value);
    const version = (expected ?? -1) + 1;
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.table,
          Item: {
            pk: owner,
            sk: id,
            data: JSON.stringify(value),
            version,
            ttl,
          },
          ConditionExpression:
            expected === null ? "attribute_not_exists(pk)" : "#v = :expected",
          ...(expected === null
            ? {}
            : {
                ExpressionAttributeNames: { "#v": "version" },
                ExpressionAttributeValues: { ":expected": expected },
              }),
        }),
      );
    } catch (e) {
      if ((e as Error).name === "ConditionalCheckFailedException")
        throw new Conflict("Conversation changed; refresh it.");
      throw e;
    }
    return version;
  }
  async delete(owner: string, id: string, expected: number) {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.table,
          Key: { pk: owner, sk: id },
          ConditionExpression: "#v = :expected",
          ExpressionAttributeNames: { "#v": "version" },
          ExpressionAttributeValues: { ":expected": expected },
        }),
      );
    } catch (e) {
      if ((e as Error).name === "ConditionalCheckFailedException")
        throw new Conflict("Conversation changed.");
      throw e;
    }
  }
}
let instance: Store | undefined;
export function store(): Store {
  if (instance) return instance;
  if (process.env.STORE_DRIVER === "dynamodb" && process.env.DYNAMODB_TABLE)
    instance = new DynamoStore(process.env.DYNAMODB_TABLE);
  else if (
    process.env.STORE_DRIVER === "file" &&
    process.env.ALLOW_LOCAL_FILE_STORE === "true"
  )
    instance = new FileStore(path.resolve(process.env.DATA_DIR ?? ".data"));
  else
    throw new Error(
      "Configure durable storage or explicitly enable local file storage.",
    );
  return instance;
}
