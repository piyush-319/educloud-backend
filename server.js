const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();
const app = express();

app.use(cors());
app.use(express.json());

const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

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

/* =========================
   JWT AUTH MIDDLEWARE
========================= */

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Authentication required",
    });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

/* =========================
   HOME
========================= */

app.get("/", (req, res) => {
  res.json({
    message: "EduCloud Backend is running 🚀",
  });
});

/* =========================
   REGISTER
========================= */

app.post("/api/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({
        message: "Name must be at least 2 characters",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!normalizedEmail.includes("@")) {
      return res.status(400).json({
        message: "Please enter a valid email",
      });
    }

    const existingUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        message: "Email already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, name, email`,
      [name.trim(), normalizedEmail, hashedPassword]
    );

    const user = result.rows[0];

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(201).json({
      message: "Registration successful",
      token,
      user,
    });
  } catch (error) {
    console.error("Register error:", error);

    res.status(500).json({
      message: "Registration failed",
    });
  }
});

/* =========================
   LOGIN
========================= */

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const result = await pool.query(
      "SELECT id, name, email, password FROM users WHERE email = $1",
      [normalizedEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Login error:", error);

    res.status(500).json({
      message: "Login failed",
    });
  }
});

/* =========================
   CURRENT USER
========================= */

app.get("/api/me", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, email, created_at FROM users WHERE id = $1",
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.json({
      user: result.rows[0],
    });
  } catch (error) {
    console.error("Me API error:", error);

    res.status(500).json({
      message: "Failed to fetch user",
    });
  }
});

// =========================
// FORGOT PASSWORD
// =========================

app.post("/api/forgot-password", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!email) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    const userResult = await pool.query(
      "SELECT id, name, email FROM users WHERE email = $1",
      [email]
    );

    // Same response whether account exists or not
    // This prevents email/account enumeration.
    const genericMessage =
      "If an account with that email exists, a password reset link has been sent.";

    if (userResult.rows.length === 0) {
      return res.json({ message: genericMessage });
    }

    const user = userResult.rows[0];

    // Remove previous unused tokens for this user
    await pool.query(
      "DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL",
      [user.id]
    );

    // Generate secure random token
    const rawToken = crypto.randomBytes(32).toString("hex");

    // Store only hash in database
    const tokenHash = crypto
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");

    // Token expires after 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens
       (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    const resetUrl =
      `${process.env.FRONTEND_URL}/?resetToken=${encodeURIComponent(rawToken)}`;

    await mailTransporter.sendMail({
      from: `"EduCloud" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: "EduCloud - Reset Your Password",
      text: `Hello ${user.name},

We received a request to reset your EduCloud password.

Reset your password using this link:

${resetUrl}

This link will expire in 1 hour.

If you did not request a password reset, you can safely ignore this email.

EduCloud`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h2>EduCloud Password Reset</h2>

          <p>Hello ${user.name},</p>

          <p>We received a request to reset your EduCloud password.</p>

          <p>
            <a
              href="${resetUrl}"
              style="
                display:inline-block;
                padding:12px 20px;
                background:#2563eb;
                color:white;
                text-decoration:none;
                border-radius:6px;
              "
            >
              Reset Password
            </a>
          </p>

          <p>This link will expire in <strong>1 hour</strong>.</p>

          <p>If you did not request a password reset, you can safely ignore this email.</p>

          <p>EduCloud</p>
        </div>
      `,
    });

    return res.json({ message: genericMessage });
  } catch (error) {
    console.error("Forgot password error:", error);

    return res.status(500).json({
      message: "Unable to process password reset request",
    });
  }
});


// =========================
// RESET PASSWORD
// =========================

app.post("/api/reset-password", async (req, res) => {
  try {
    const token = String(req.body.token || "").trim();
    const password = String(req.body.password || "");

    if (!token || !password) {
      return res.status(400).json({
        message: "Token and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const tokenResult = await pool.query(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP`,
      [tokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(400).json({
        message: "Invalid or expired reset link",
      });
    }

    const resetToken = tokenResult.rows[0];

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password = $1 WHERE id = $2",
      [hashedPassword, resetToken.user_id]
    );

    // Mark this token as used
    await pool.query(
      `UPDATE password_reset_tokens
       SET used_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [resetToken.id]
    );

    // Delete any other unused tokens for this user
    await pool.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1
         AND used_at IS NULL`,
      [resetToken.user_id]
    );

    return res.json({
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Reset password error:", error);

    return res.status(500).json({
      message: "Unable to reset password",
    });
  }
});

/* =========================
   COURSES
========================= */

app.get("/api/courses", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, title, description, icon FROM courses ORDER BY id"
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Courses API error:", error);

    res.status(500).json({
      message: "Failed to fetch courses",

    });
  }
});
app.get("/api/courses/:courseId/lessons", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, course_id, title, content, lesson_order FROM lessons WHERE course_id = $1 ORDER BY lesson_order",
      [req.params.courseId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Lessons API error:", error);

    res.status(500).json({
      message: "Failed to fetch lessons",
    });
  }
});
/* =========================
   LESSON PROGRESS
========================= */

/* SAVE / COMPLETE LESSON */

app.post("/api/progress/:lessonId", authenticateToken, async (req, res) => {
  try {
    const lessonId = Number(req.params.lessonId);

    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({
        message: "Invalid lesson ID",
      });
    }

    const result = await pool.query(
      `INSERT INTO lesson_progress (user_id, lesson_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, lesson_id)
       DO UPDATE SET completed_at = CURRENT_TIMESTAMP
       RETURNING id, user_id, lesson_id, completed_at`,
      [req.user.id, lessonId]
    );

    res.json({
      message: "Lesson progress saved",
      progress: result.rows[0],
    });
  } catch (error) {
    console.error("Save progress error:", error);

    res.status(500).json({
      message: "Failed to save lesson progress",
    });
  }
});


/* GET USER PROGRESS */

app.get("/api/progress", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT lesson_id, completed_at
       FROM lesson_progress
       WHERE user_id = $1
       ORDER BY lesson_id`,
      [req.user.id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Get progress error:", error);

    res.status(500).json({
      message: "Failed to fetch lesson progress",
    });
  }
});

/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`EduCloud Backend running on port ${PORT}`);
});
