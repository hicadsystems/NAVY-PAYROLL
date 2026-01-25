const jwt = require("jsonwebtoken");
const config = require("../config");
const pool = require("../config/db");

const SECRET = config.jwt.secret;
if (!SECRET) {
  throw new Error("JWT_SECRET is not set in environment variables");
}

// Reverse mapping for display
const PAYROLL_MAPPING = {
  OFFICERS: config.databases.officers,
  "W/OFFICER": config.databases.wofficers,
  "RATE A": config.databases.ratings,
  "RATE B": config.databases.ratingsA,
  "RATE C": config.databases.ratingsB,
  TRAINEE: config.databases.juniorTrainee,
};

const verifyToken = async (req, res, next) => {
  const bearerHeader = req.headers["authorization"];
  let token = null;

  if (bearerHeader && bearerHeader.startsWith("Bearer ")) {
    token = bearerHeader.split(" ")[1];
  }

  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  // if (await redisTokenManager.isTokenBlacklisted(token)) {
  //   return res.status(403).json({ message: "Please Log In" });
  // }

  try {
    const decoded = jwt.verify(token, SECRET);

    pool.useDatabase(config.databases.officers);

    const [res] = await pool.query(
      "SELECT token FROM users WHERE user_id = ?",
      [decoded.user_id],
    );

    if (!res || res.length === 0) {
      return res.status(401).json({ message: "Please Log In" });
    }

    if (res[0].token !== token) {
      return res.status(401).json({ message: "Please Log In" });
    }

    // Attach user info to the request object
    req.user_id = decoded.user_id;
    req.user_fullname = decoded.full_name;
    req.user_role = decoded.role;
    req.primary_class = PAYROLL_MAPPING[decoded.primary_class];
    req.current_class = PAYROLL_MAPPING[decoded.current_class];

    // Set database context based on user's current class
    if (decoded.current_class) {
      try {
        const databaseName = PAYROLL_MAPPING[decoded.current_class];
        const sessionId = decoded.user_id.toString();

        // ⬅️ Set on request object FIRST
        req.current_database = databaseName;
        req.session_id = sessionId;

        // Get session context
        const sessionContext = pool._getSessionContext
          ? pool._getSessionContext()
          : null;

        if (sessionContext) {
          // Run entire request chain in this context
          return sessionContext.run(sessionId, () => {
            try {
              pool.useDatabase(databaseName, sessionId);
              console.log(
                `🔄 DB set to: ${databaseName} for user: ${decoded.user_id}`,
              );
              next();
            } catch (dbError) {
              console.error("❌ Database context error:", dbError);
              return res
                .status(500)
                .json({ message: "Database context error" });
            }
          });
        } else {
          // Fallback without sessionContext
          pool.useDatabase(databaseName, sessionId);
          console.log(
            `🔄 DB set to: ${databaseName} for user: ${decoded.user_id}`,
          );
          return next();
        }
      } catch (dbError) {
        console.error("❌ Database context error:", dbError);
        return res.status(500).json({ message: "Database context error" });
      }
    } else {
      return next();
    }
  } catch (err) {
    if (err) {
      if (err.name === "TokenExpiredError") {
        return res.status(401).json({ message: "Token has expired" });
      }
      return res.status(401).json({ message: "Please Log In" });
    }
  }
};

module.exports = verifyToken;
