import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { type Connection } from 'mongoose';

export interface TestDb {
  connection: Connection;
  stop(): Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const mongod = await MongoMemoryServer.create();
  const connection = mongoose.createConnection(mongod.getUri());
  await connection.asPromise();
  return {
    connection,
    async stop() {
      await connection.close();
      await mongod.stop();
    }
  };
}
