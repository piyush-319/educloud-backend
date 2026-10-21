const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function checkDatabase() {
  try {
    const result = await pool.query(
      "SELECT id, title, description, icon FROM courses ORDER BY id"
    );

    console.table(result.rows);
  } catch (error) {
    console.error("Database check failed:", error);
  } finally {
    await pool.end();
  }
}

checkDatabase();
