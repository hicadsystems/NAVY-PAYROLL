const jwt = require("jsonwebtoken");
const redis = require("redis");

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

class RedisTokenManager {
  constructor() {
    this.client = null;
    this.isConnected = false;

    this.initRedis();
  }

  // ============================================
  // REDIS CONNECTION
  // ============================================

  async initRedis() {
    try {
      // Create Redis client
      this.client = redis.createClient({
        socket: {
          host: REDIS_HOST,
          port: REDIS_PORT,
        },
        password: REDIS_PASSWORD,
        // Reconnect strategy
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error("❌ Redis: Too many reconnection attempts");
              return new Error("Redis reconnection failed");
            }
            return retries * 100; // Exponential backoff
          },
        },
      });

      // Event handlers
      this.client.on("connect", () => {
        console.log("🔄 Redis: Connecting...");
      });

      this.client.on("ready", () => {
        console.log("✅ Redis: Connected and ready");
        this.isConnected = true;
      });

      this.client.on("error", (err) => {
        console.error("❌ Redis error:", err);
        this.isConnected = false;
      });

      this.client.on("end", () => {
        console.log("🔌 Redis: Connection closed");
        this.isConnected = false;
      });

      // Connect to Redis
      await this.client.connect();
    } catch (err) {
      console.error("❌ Failed to initialize Redis:", err);
      throw err;
    }
  }

  // ============================================
  // TOKEN METHODS
  // ============================================

  /**
   * Blacklist token (for logout)
   */
  async blacklistToken(token) {
    try {
      if (!this.isConnected) {
        throw new Error("Redis not connected");
      }

      const decoded = jwt.decode(token);
      if (!decoded || !decoded.exp) {
        return false;
      }

      // Calculate remaining TTL
      const now = Math.floor(Date.now() / 1000);
      const ttl = decoded.exp - now;

      if (ttl > 0) {
        // Store in Redis with TTL
        const key = `blacklist:${token}`;
        await this.client.setEx(
          key,
          ttl,
          JSON.stringify({
            user_id: decoded.user_id,
            blacklisted_at: new Date().toISOString(),
          })
        );

        console.log(
          `🔒 Token blacklisted for user: ${decoded.user_id} (TTL: ${ttl}s)`
        );
        return true;
      }

      return false;
    } catch (err) {
      console.error("Error blacklisting token:", err);
      return false;
    }
  }

  /**
   * Check if token is blacklisted
   */
  async isTokenBlacklisted(token) {
    try {
      if (!this.isConnected) {
        return false;
      }
      const key = `blacklist:${token}`;
      const exists = await this.client.exists(key);

      return exists === 1;
    } catch (err) {
      console.error("Error checking blacklist:", err);
      return false;
    }
  }

  /**
   * Revoke all refresh tokens for a user (logout all devices)
   */
  async revokeAllUserTokens(user_id) {
    try {
      if (!this.isConnected) {
        throw new Error("Redis not connected");
      }

      const userTokensKey = `user:${user_id}:tokens`;

      // Get all tokens for this user
      const tokens = await this.client.sMembers(userTokensKey);

      if (tokens.length === 0) {
        console.log(`⚠️ No active tokens found for user: ${user_id}`);
        return 0;
      }

      // Delete all tokens
      const deletePromises = tokens.map((token) =>
        this.client.del(`refresh:${token}`)
      );

      await Promise.all(deletePromises);

      // Delete the user's token set
      await this.client.del(userTokensKey);

      console.log(
        `🔒 Revoked ${tokens.length} refresh tokens for user: ${user_id}`
      );
      return tokens.length;
    } catch (err) {
      console.error("Error revoking all user tokens:", err);
      return 0;
    }
  }

  // ============================================
  // MONITORING
  // ============================================

  /**
   * Health check
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return {
          status: "disconnected",
          message: "Redis client not connected",
        };
      }

      await this.client.ping();
      return { status: "healthy", message: "Redis connection active" };
    } catch (err) {
      return { status: "unhealthy", message: err.message };
    }
  }

  // ============================================
  // CLEANUP & SHUTDOWN
  // ============================================

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      if (this.client) {
        await this.client.quit();
        console.log("✅ Redis connection closed gracefully");
      }
    } catch (err) {
      console.error("Error closing Redis connection:", err);
    }
  }
}

// ============================================
// SINGLETON INSTANCE
// ============================================

const redisTokenManager = new RedisTokenManager();

// Graceful shutdown handlers
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM received, closing Redis connection...");
  await redisTokenManager.shutdown();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("🛑 SIGINT received, closing Redis connection...");
  await redisTokenManager.shutdown();
  process.exit(0);
});

module.exports = redisTokenManager;
