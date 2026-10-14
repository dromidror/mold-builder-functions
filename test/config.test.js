import { describe, expect, it } from "vitest";
import { usersConnection } from "../authFunctions.js";

describe("users table connection", () => {
  it("prefers USERS_STORAGE_CONNECTION, then the Flex deployment storage, then AzureWebJobsStorage", () => {
    expect(usersConnection({ USERS_STORAGE_CONNECTION: "a", DEPLOYMENT_STORAGE_CONNECTION_STRING: "b", AzureWebJobsStorage: "c" })).toBe("a");
    expect(usersConnection({ DEPLOYMENT_STORAGE_CONNECTION_STRING: "b", AzureWebJobsStorage: "c" })).toBe("b");
    expect(usersConnection({ AzureWebJobsStorage: "c" })).toBe("c");
    expect(usersConnection({})).toBe("");
  });
});
