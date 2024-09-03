import { OpenAI } from "openai";
import { Client } from "pg";
import pgvector from "pgvector/pg";

const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const POSTGRES_USER = process.env.POSTGRES_USER;
const POSTGRES_DB = process.env.POSTGRES_DB;
const POSTGRES_PORT = process.env.POSTGRES_PORT;

const VECTOR_SIZE = 1536;

/**
 * ```console
 * $ docker compose up
 * $ npx tsx --env-file=.env main.ts
 * ```
 */
async function main() {
  // instantiate OpenAI client
  const oa = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // echo input
  const actual = "topping pizza";
  console.log("Input:", actual);

  // convert input to vector
  const embeddings = await oa.embeddings.create({
    model: "text-embedding-3-small",
    dimensions: VECTOR_SIZE,
    input: actual,
  });

  const vector = embeddings.data[0].embedding;

  const client = new Client({
    user: POSTGRES_USER,
    host: "localhost",
    database: POSTGRES_DB,
    password: POSTGRES_PASSWORD,
    port: parseInt(POSTGRES_PORT!),
  });
  await client.connect();

  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  // TODO: Wait for Postgres 17 for uuidv7 or figure out
  // how to install https://pgxn.org/dist/pg_uuidv7/ on Postgres Docker

  // await client.query("CREATE EXTENSION IF NOT EXISTS pg_uuidv7");
  await pgvector.registerTypes(client);

  // await client.query(`DROP TABLE IF EXISTS items`);
  // await client.query(
  //   `CREATE TABLE items
  //   (id bigserial PRIMARY KEY,
  //    actual text,
  //    embedding vector(${VECTOR_SIZE}),
  //    link text,
  //    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  //    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  //   )`
  // );

  // CREATE FUNCTION trigger_updated_at() RETURNS trigger
  //    LANGUAGE plpgsql AS
  // $$BEGIN
  //    NEW.updated_at := current_timestamp;
  //    RETURN NEW;
  // END;$$;

  // CREATE TRIGGER items_trigger_on_updated_at BEFORE UPDATE ON items
  //  FOR EACH ROW EXECUTE PROCEDURE trigger_updated_at();

  // await client.query("INSERT INTO items (actual, embedding) VALUES ($1, $2)", [
  //   actual,
  //   pgvector.toSql(vector),
  // ]);

  const result = await client.query(
    "SELECT id, actual FROM items ORDER BY embedding <-> $1 LIMIT 5",
    [pgvector.toSql(vector)]
  );
  //
  console.log(result.rows);

  client.end();
}

main();
