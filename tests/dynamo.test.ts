import { expect, it, vi } from "vitest";
import { DynamoStore, Conflict } from "@/lib/server/store";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
it("uses owner partition keys, consistent reads and conditional writes/deletes", async () => {
  const send = vi.fn().mockResolvedValue({});
  const client = { send } as unknown as DynamoDBDocumentClient;
  const db = new DynamoStore("Table", client);
  await db.get("USER#alice", "id");
  expect(send.mock.calls[0][0].input).toMatchObject({
    Key: { pk: "USER#alice", sk: "id" },
    ConsistentRead: true,
  });
  await db.put("USER#alice", "id", { title: "Research" }, null);
  expect(send.mock.calls[1][0].input.ConditionExpression).toBe(
    "attribute_not_exists(pk)",
  );
  await db.put("USER#alice", "id", { title: "Research" }, 2);
  expect(send.mock.calls[2][0].input.ExpressionAttributeValues).toEqual({
    ":expected": 2,
  });
  send.mockRejectedValueOnce(
    Object.assign(new Error(), { name: "ConditionalCheckFailedException" }),
  );
  await expect(db.put("USER#alice", "id", {}, 2)).rejects.toBeInstanceOf(
    Conflict,
  );
  await db.delete("USER#alice", "id", 3);
  expect(send.mock.calls.at(-1)![0].input).toMatchObject({
    Key: { pk: "USER#alice", sk: "id" },
    ExpressionAttributeValues: { ":expected": 3 },
  });
});
