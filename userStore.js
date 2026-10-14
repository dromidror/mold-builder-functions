import { TableClient } from "@azure/data-tables";

const PARTITION = "user";

/** Users kept in memory (tests and local experiments). */
export class MemoryUserStore {
  constructor() { this.users = new Map(); }
  async get(email) { return this.users.get(email) ?? null; }
  /** Add `user`; false when that email is already taken. */
  async create(user) {
    if (this.users.has(user.email)) return false;
    this.users.set(user.email, { ...user });
    return true;
  }
}

/**
 * Users in an Azure Storage table: one entity per user, RowKey = normalized email, so creating
 * an existing email fails atomically (409) — no race between two sign ups.
 */
export class TableUserStore {
  constructor(connectionString, tableName) {
    this.client = TableClient.fromConnectionString(connectionString, tableName);
    this.ready = null;
  }

  async init() {
    if (!this.ready) {
      this.ready = this.client.createTable().catch((err) => {
        if (err.statusCode !== 409) { this.ready = null; throw err; }
      });
    }
    return this.ready;
  }

  async get(email) {
    await this.init();
    try {
      const e = await this.client.getEntity(PARTITION, email);
      return { email, name: e.name ?? "", passwordHash: e.passwordHash, createdAt: e.createdAt };
    } catch (err) {
      if (err.statusCode === 404) return null;
      throw err;
    }
  }

  async create(user) {
    await this.init();
    try {
      await this.client.createEntity({
        partitionKey: PARTITION, rowKey: user.email,
        name: user.name, passwordHash: user.passwordHash, createdAt: user.createdAt
      });
      return true;
    } catch (err) {
      if (err.statusCode === 409) return false;
      throw err;
    }
  }
}
