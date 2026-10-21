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

async function seedDatabase() {
  try {
    await pool.query(`
      INSERT INTO courses (title, description, icon)
      VALUES
        ('AWS', 'Learn AWS cloud services and practical cloud skills.', '☁️'),
        ('Linux & DevOps', 'Learn Linux, DevOps and server management.', '🐧'),
        ('Python', 'Learn Python programming through practical projects.', '🐍')
      ON CONFLICT DO NOTHING;
    `);

    console.log("EduCloud courses added successfully ✅");
  } catch (error) {
    console.error("Seeding failed:", error);
  } finally {
    await pool.end();
  }
}

seedDatabase();
