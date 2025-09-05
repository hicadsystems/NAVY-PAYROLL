// setup.js - Database setup and initial configuration
const mysql = require('mysql2/promise');
const fs = require('fs').promises;
require('dotenv').config();

class SetupManager {
    constructor() {
        this.dbConfig = {
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            port: process.env.DB_PORT || 3306
        };
    }

    async createDatabase() {
        const connection = await mysql.createConnection(this.dbConfig);
        
        try {
            console.log('Creating database...');
            await connection.execute(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME || 'backup_manager'} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
            console.log('✓ Database created successfully');
        } catch (error) {
            console.error('Failed to create database:', error);
            throw error;
        } finally {
            await connection.end();
        }
    }

    async createTables() {
        const connection = await mysql.createConnection({
            ...this.dbConfig,
            database: process.env.DB_NAME || 'backup_manager'
        });

        try {
            console.log('Creating tables...');

            // Backup configurations table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS backup_configs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    database_name VARCHAR(255) NOT NULL,
                    backup_type ENUM('full', 'structure', 'data') DEFAULT 'full',
                    compression BOOLEAN DEFAULT TRUE,
                    storage_type ENUM('local', 'ftp', 'cloud') DEFAULT 'local',
                    schedule_type ENUM('manual', 'daily', 'weekly', 'monthly') DEFAULT 'manual',
                    schedule_time TIME DEFAULT '02:00:00',
                    schedule_enabled BOOLEAN DEFAULT TRUE,
                    storage_config JSON,
                    retention_days INT DEFAULT 30,
                    max_backups INT DEFAULT 10,
                    notification_email VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE,
                    INDEX idx_database_name (database_name),
                    INDEX idx_schedule_type (schedule_type),
                    INDEX idx_is_active (is_active)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Backup history table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS backup_history (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    config_id INT,
                    database_name VARCHAR(255) NOT NULL,
                    backup_type VARCHAR(50) NOT NULL,
                    file_name VARCHAR(255),
                    file_path VARCHAR(500),
                    file_size BIGINT DEFAULT 0,
                    compressed_size BIGINT DEFAULT 0,
                    status ENUM('pending', 'running', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
                    progress_percentage TINYINT DEFAULT 0,
                    error_message TEXT,
                    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP NULL,
                    duration_seconds INT DEFAULT 0,
                    storage_location VARCHAR(500),
                    storage_type VARCHAR(50),
                    checksum VARCHAR(64),
                    expires_at TIMESTAMP NULL,
                    FOREIGN KEY (config_id) REFERENCES backup_configs(id) ON DELETE SET NULL,
                    INDEX idx_config_id (config_id),
                    INDEX idx_database_name (database_name),
                    INDEX idx_status (status),
                    INDEX idx_started_at (started_at),
                    INDEX idx_expires_at (expires_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Storage configurations table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS storage_configs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    type ENUM('local', 'ftp', 'sftp', 'aws-s3', 'google-cloud', 'azure-blob') NOT NULL,
                    configuration JSON NOT NULL,
                    is_active BOOLEAN DEFAULT TRUE,
                    test_connection_at TIMESTAMP NULL,
                    connection_status ENUM('unknown', 'success', 'failed') DEFAULT 'unknown',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_type (type),
                    INDEX idx_is_active (is_active)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // System logs table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS system_logs (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    level ENUM('debug', 'info', 'warning', 'error', 'critical') NOT NULL,
                    category VARCHAR(100) NOT NULL,
                    message TEXT NOT NULL,
                    context JSON,
                    user_id VARCHAR(100),
                    ip_address VARCHAR(45),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_level (level),
                    INDEX idx_category (category),
                    INDEX idx_created_at (created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // System settings table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS system_settings (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    setting_key VARCHAR(255) NOT NULL UNIQUE,
                    setting_value TEXT,
                    setting_type ENUM('string', 'number', 'boolean', 'json') DEFAULT 'string',
                    description TEXT,
                    is_editable BOOLEAN DEFAULT TRUE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    INDEX idx_setting_key (setting_key)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            // Database connections table
            await connection.execute(`
                CREATE TABLE IF NOT EXISTS database_connections (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    name VARCHAR(255) NOT NULL UNIQUE,
                    host VARCHAR(255) NOT NULL,
                    port INT DEFAULT 3306,
                    username VARCHAR(255) NOT NULL,
                    password VARCHAR(255) NOT NULL,
                    ssl_enabled BOOLEAN DEFAULT FALSE,
                    ssl_config JSON,
                    test_connection_at TIMESTAMP NULL,
                    connection_status ENUM('unknown', 'success', 'failed') DEFAULT 'unknown',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    is_active BOOLEAN DEFAULT TRUE,
                    INDEX idx_name (name),
                    INDEX idx_is_active (is_active)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);

            console.log('✓ Tables created successfully');
        } catch (error) {
            console.error('Failed to create tables:', error);
            throw error;
        } finally {
            await connection.end();
        }
    }

    async insertDefaultSettings() {
        const connection = await mysql.createConnection({
            ...this.dbConfig,
            database: process.env.DB_NAME || 'backup_manager'
        });

        try {
            console.log('Inserting default settings...');

            const defaultSettings = [
                ['backup_retention_days', '30', 'number', 'Default retention period for backups in days'],
                ['max_concurrent_backups', '3', 'number', 'Maximum number of concurrent backup operations'],
                ['backup_compression_level', '6', 'number', 'Compression level for backups (1-9)'],
                ['notification_enabled', 'true', 'boolean', 'Enable email notifications for backup events'],
                ['auto_cleanup_enabled', 'true', 'boolean', 'Automatically delete expired backups'],
                ['health_check_interval', '300', 'number', 'Health check interval in seconds'],
                ['backup_timeout', '3600', 'number', 'Backup operation timeout in seconds'],
                ['disk_space_threshold', '85', 'number', 'Disk space usage threshold percentage'],
                ['log_retention_days', '90', 'number', 'System log retention period in days'],
                ['api_rate_limit', '100', 'number', 'API requests per window'],
                ['backup_verification_enabled', 'true', 'boolean', 'Verify backup integrity after creation']
            ];

            for (const [key, value, type, description] of defaultSettings) {
                await connection.execute(`
                    INSERT IGNORE INTO system_settings 
                    (setting_key, setting_value, setting_type, description) 
                    VALUES (?, ?, ?, ?)
                `, [key, value, type, description]);
            }

            console.log('✓ Default settings inserted successfully');
        } catch (error) {
            console.error('Failed to insert default settings:', error);
            throw error;
        } finally {
            await connection.end();
        }
    }

    async createDirectories() {
        console.log('Creating directories...');

        const directories = [
            './backups',
            './logs',
            './temp',
            './uploads',
            './ssl'
        ];

        for (const dir of directories) {
            try {
                await fs.mkdir(dir, { recursive: true });
                console.log(`✓ Created directory: ${dir}`);
            } catch (error) {
                if (error.code !== 'EEXIST') {
                    console.error(`Failed to create directory ${dir}:`, error);
                    throw error;
                }
            }
        }
    }

    async createLogFiles() {
        console.log('Creating log files...');

        const logFiles = [
            './logs/application.log',
            './logs/error.log',
            './logs/backup.log',
            './logs/access.log'
        ];

        for (const logFile of logFiles) {
            try {
                await fs.writeFile(logFile, '', { flag: 'a' });
                console.log(`✓ Created log file: ${logFile}`);
            } catch (error) {
                console.error(`Failed to create log file ${logFile}:`, error);
                throw error;
            }
        }
    }

    async createSampleConfig() {
        console.log('Creating sample configuration files...');

        // Sample backup configuration
        const sampleBackupConfig = {
            name: "Sample Website Backup",
            database_name: "website_main",
            backup_type: "full",
            compression: true,
            storage_type: "local",
            schedule_type: "daily",
            schedule_time: "02:00:00",
            retention_days: 7,
            storage_config: {
                path: "./backups"
            }
        };

        await fs.writeFile(
            './sample-backup-config.json', 
            JSON.stringify(sampleBackupConfig, null, 2)
        );

        // Sample storage configuration
        const sampleStorageConfigs = {
            local: {
                type: "local",
                path: "./backups",
                permissions: "0755"
            },
            ftp: {
                type: "ftp",
                host: "ftp.example.com",
                port: 21,
                username: "backup_user",
                password: "secure_password",
                remote_path: "/backups",
                passive: true
            },
            aws_s3: {
                type: "aws-s3",
                region: "us-west-2",
                bucket: "my-backup-bucket",
                access_key_id: "YOUR_ACCESS_KEY",
                secret_access_key: "YOUR_SECRET_KEY",
                path_prefix: "database-backups/"
            }
        };

        await fs.writeFile(
            './sample-storage-configs.json', 
            JSON.stringify(sampleStorageConfigs, null, 2)
        );

        console.log('✓ Sample configuration files created');
    }

    async verifySetup() {
        console.log('Verifying setup...');

        try {
            // Test database connection
            const connection = await mysql.createConnection({
                ...this.dbConfig,
                database: process.env.DB_NAME || 'backup_manager'
            });

            // Test basic queries
            const [tables] = await connection.execute("SHOW TABLES");
            console.log(`✓ Database connection successful (${tables.length} tables found)`);

            // Test directory permissions
            await fs.access('./backups', fs.constants.W_OK);
            console.log('✓ Backup directory is writable');

            await connection.end();

            console.log('\n🎉 Setup completed successfully!\n');
            console.log('Next steps:');
            console.log('1. Update your .env file with your actual credentials');
            console.log('2. Configure your cPanel API settings');
            console.log('3. Run "npm start" to start the backup server');
            console.log('4. Access the web interface at http://localhost:3000');

        } catch (error) {
            console.error('❌ Setup verification failed:', error);
            throw error;
        }
    }

    async run() {
        try {
            console.log('Starting database backup system setup...\n');

            await this.createDatabase();
            await this.createTables();
            await this.insertDefaultSettings();
            await this.createDirectories();
            await this.createLogFiles();
            await this.createSampleConfig();
            await this.verifySetup();

        } catch (error) {
            console.error(' Setup failed:', error);
            process.exit(1);
        }
    }
}

// Run setup if called directly
if (require.main === module) {
    const setup = new SetupManager();
    setup.run();
}

module.exports = SetupManager;

// Additional utility functions for database management

class DatabaseUtils {
    static async testConnection(config) {
        try {
            const connection = await mysql.createConnection(config);
            await connection.ping();
            await connection.end();
            return { success: true, message: 'Connection successful' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    static async getDatabaseSize(config, databaseName) {
        try {
            const connection = await mysql.createConnection(config);
            const [rows] = await connection.execute(`
                SELECT 
                    ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS 'size_mb'
                FROM information_schema.tables 
                WHERE table_schema = ?
            `, [databaseName]);
            await connection.end();
            return rows[0]?.size_mb || 0;
        } catch (error) {
            console.error('Failed to get database size:', error);
            return 0;
        }
    }

    static async getTableList(config, databaseName) {
        try {
            const connection = await mysql.createConnection({
                ...config,
                database: databaseName
            });
            const [tables] = await connection.execute('SHOW TABLES');
            await connection.end();
            return tables.map(row => Object.values(row)[0]);
        } catch (error) {
            console.error('Failed to get table list:', error);
            return [];
        }
    }

    static async validateBackupFile(filePath) {
        try {
            const stats = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf8');
            
            // Basic validation - check for SQL dump markers
            const hasHeader = content.includes('-- MySQL dump') || 
                            content.includes('-- mysqldump') ||
                            content.includes('CREATE TABLE') ||
                            content.includes('INSERT INTO');
            
            return {
                isValid: hasHeader && stats.size > 0,
                size: stats.size,
                created: stats.birthtime
            };
        } catch (error) {
            return {
                isValid: false,
                error: error.message
            };
        }
    }

    static generateBackupFileName(databaseName, backupType, timestamp = new Date()) {
        const dateStr = timestamp.toISOString()
            .replace(/[:.]/g, '-')
            .replace('T', '_')
            .split('.')[0];
        
        return `${databaseName}_${backupType}_${dateStr}.sql`;
    }

    static async calculateChecksum(filePath) {
        try {
            const crypto = require('crypto');
            const fileBuffer = await fs.readFile(filePath);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            return hashSum.digest('hex');
        } catch (error) {
            console.error('Failed to calculate checksum:', error);
            return null;
        }
    }
}

module.exports = { SetupManager, DatabaseUtils };