import { OpenAI } from "openai";
import { Client } from "pg";
import pgvector from "pgvector/pg";
import { Command } from "commander";

const program = new Command();

const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD;
const POSTGRES_USER = process.env.POSTGRES_USER;
const POSTGRES_DB = process.env.POSTGRES_DB;
const POSTGRES_PORT = process.env.POSTGRES_PORT;

const VECTOR_SIZE = 1536;

const client = new Client({
  user: POSTGRES_USER,
  host: "localhost",
  database: POSTGRES_DB,
  password: POSTGRES_PASSWORD,
  port: parseInt(POSTGRES_PORT!),
});

const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * ```console
 * $ docker compose up
 * $ npx tsx --env-file=.env main.ts
 * ```
 */

program
  .name("local-vectors")
  .description("CLI to some do similarity search with vectors");

// npx tsx --env-file=.env main.ts init
program.command("init").action(async () => {
  console.log("Initializing");
  try {
    await client.connect();
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");
    // TODO: Wait for Postgres 17 for uuidv7 or figure out
    // how to install https://pgxn.org/dist/pg_uuidv7/ on Postgres Docker

    // await client.query("CREATE EXTENSION IF NOT EXISTS pg_uuidv7");
    await pgvector.registerTypes(client);

    await client.query(`DROP TABLE IF EXISTS items`);
    await client.query(
      `CREATE TABLE items
      (id bigserial PRIMARY KEY,
       actual text,
       embedding vector(${VECTOR_SIZE}),
       links text[],
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`
    );

    await client.query(`CREATE FUNCTION trigger_updated_at() RETURNS trigger
       LANGUAGE plpgsql AS
    $$BEGIN
       NEW.updated_at := current_timestamp;
       RETURN NEW;
    END;$$;
  
     CREATE TRIGGER items_trigger_on_updated_at BEFORE UPDATE ON items
     FOR EACH ROW EXECUTE PROCEDURE trigger_updated_at();
     `);

    console.log("Initialized");
    client.end();
  } catch (error) {
    console.error(error);
  }
});

// npx tsx --env-file=.env main.ts add "hello world" "link1" "link2"
program
  .command("add")
  .arguments("<input> <links...>")
  .action(async (input: string, links: string[]) => {
    console.log("Adding:", input, links);
    if (links.length === 0) {
      console.error("No links provided");
      return;
    }

    // convert input to vector
    const embeddings = await oa.embeddings.create({
      model: "text-embedding-3-small",
      dimensions: VECTOR_SIZE,
      input: input,
    });

    const vector = embeddings.data[0].embedding;

    await client.connect();

    await client.query(
      "INSERT INTO items (actual, embedding, links) VALUES ($1, $2, $3)",
      [input, pgvector.toSql(vector), links]
    );

    client.end();
  });

program.command("delete <id>").action(async (id: string) => {
  console.log("Deleting:", id);

  await client.connect();

  await client.query("DELETE FROM items WHERE id = $1", [id]);

  client.end();
});

// npx tsx --env-file=.env main.ts search "hello world"
program.command("search <input>").action(async (input: string) => {
  console.log("Searching for:", input);

  // convert input to vector
  const embeddings = await oa.embeddings.create({
    model: "text-embedding-3-small",
    dimensions: VECTOR_SIZE,
    input: input,
  });

  const vector = embeddings.data[0].embedding;

  await client.connect();

  const result = await client.query(
    `SELECT id, actual, links
    FROM items
    ORDER BY embedding <-> $1 LIMIT 5`,
    [pgvector.toSql(vector)]
  );
  //
  console.log(result.rows);

  client.end();
});
program.parse();
