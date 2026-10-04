import { MongoClient, MongoServerError, type Collection } from "mongodb";
import { rateLimitWindow, type Database, type DocumentQuery, type StoredDocument } from "./database.types.js";

type Document = { _id: string; collection: string; revision: number; value: unknown };
type RateLimit = { _id: string; windowStart: number; count: number };

export class MongoDatabase implements Database {
  private ready?: Promise<void>;
  private readonly documents: Collection<Document>;
  private readonly limits: Collection<RateLimit>;

  constructor(private readonly client: MongoClient) {
    const database = client.db();
    this.documents = database.collection<Document>("noob_documents");
    this.limits = database.collection<RateLimit>("noob_request_limits");
  }

  static connect(uri: string): MongoDatabase {
    return new MongoDatabase(
      new MongoClient(uri, { maxPoolSize: 10, serverSelectionTimeoutMS: 10_000, writeConcern: { w: "majority" } }),
    );
  }

  initialize(): Promise<void> {
    this.ready ??= this.client
      .connect()
      .then(async () => {
        await this.documents.createIndex({ collection: 1 });
        await this.documents.createIndex({ "value.$**": 1 });
      })
      .catch(error => {
        this.ready = undefined;
        throw error;
      });
    return this.ready;
  }

  async create<T>(collection: string, id: string, value: T): Promise<void> {
    await this.initialize();
    await this.documents.insertOne({ _id: `${collection}:${id}`, collection, revision: 0, value });
  }

  async read<T>(collection: string, id: string): Promise<StoredDocument<T> | null> {
    await this.initialize();
    const document = await this.documents.findOne({ _id: `${collection}:${id}` });
    return document ? { revision: document.revision, value: document.value as T } : null;
  }

  async replace<T>(collection: string, id: string, revision: number, value: T): Promise<boolean> {
    await this.initialize();
    const result = await this.documents.updateOne(
      { _id: `${collection}:${id}`, revision },
      { $set: { value }, $inc: { revision: 1 } },
    );
    return result.modifiedCount === 1;
  }

  async list<T>(collection: string, query: DocumentQuery): Promise<T[]> {
    await this.initialize();
    const documents = await this.documents
      .find({ collection, [`value.${query.path.join(".")}`]: { $in: query.values } })
      .sort({ [`value.${query.orderBy.join(".")}`]: 1 })
      .limit(query.limit)
      .toArray();
    return documents.map(document => document.value as T);
  }

  async consumeRateLimit(bucket: string, maximum: number, windowSeconds: number, now: number): Promise<boolean> {
    const windowStart = rateLimitWindow(bucket, maximum, windowSeconds, now);
    await this.initialize();
    const update = [
      {
        $set: {
          windowStart,
          count: {
            $cond: [
              { $eq: ["$windowStart", windowStart] },
              { $min: [{ $add: [{ $ifNull: ["$count", 0] }, 1] }, maximum + 1] },
              1,
            ],
          },
        },
      },
    ];
    let result;
    try {
      result = await this.limits.findOneAndUpdate({ _id: bucket }, update, { upsert: true, returnDocument: "after" });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      result = await this.limits.findOneAndUpdate({ _id: bucket }, update, { returnDocument: "after" });
    }
    return result !== null && result.count <= maximum;
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
