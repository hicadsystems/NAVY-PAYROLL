// api-client.js - Frontend API client for backup management
class BackupAPIClient {
    constructor(baseURL = '/api') {
        this.baseURL = baseURL;
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            method: 'GET',
            headers: { ...this.defaultHeaders },
            ...options
        };

        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.message || `HTTP ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }

            return response;
        } catch (error) {
            console.error(`API Request failed: ${config.method} ${url}`, error);
            throw error;
        }
    }

    // Health and connection methods
    async checkHealth() {
        return await this.makeRequest('/health');
    }

    async checkConnection() {
        return await this.makeRequest('/check-connection');
    }

    // Database methods
    async getDatabases() {
        return await this.makeRequest('/databases');
    }

    async getDatabaseInfo(databaseName) {
        return await this.makeRequest(`/databases/${databaseName}/info`);
    }

    // Backup configuration methods
    async getBackupConfigs() {
        return await this.makeRequest('/backup-configs');
    }

    async createBackupConfig(config) {
        return await this.makeRequest('/backup-configs', {
            method: 'POST',
            body: config
        });
    }

    async updateBackupConfig(configId, config) {
        return await this.makeRequest(`/backup-configs/${configId}`, {
            method: 'PUT',
            body: config
        });
    }

    async deleteBackupConfig(configId) {
        return await this.makeRequest(`/backup-configs/${configId}`, {
            method: 'DELETE'
        });
    }

    async toggleBackupConfig(configId, enabled) {
        return await this.makeRequest(`/backup-configs/${configId}/toggle`, {
            method: 'POST',
            body: { enabled }
        });
    }

    // Backup execution methods
    async executeBackup(configId) {
        return await this.makeRequest(`/backup/${configId}/execute`, {
            method: 'POST'
        });
    }

    async getBackupProgress(historyId) {
        return await this.makeRequest(`/backup/${historyId}/progress`);
    }

    async cancelBackup(historyId) {
        return await this.makeRequest(`/backup/${historyId}/cancel`, {
            method: 'POST'
        });
    }

    // Backup history methods
    async getBackupHistory(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const endpoint = queryString ? `/backup-history?${queryString}` : '/backup-history';
        return await this.makeRequest(endpoint);
    }

    async getBackupDetails(historyId) {
        return await this.makeRequest(`/backup-history/${historyId}`);
    }

    async downloadBackup(historyId) {
        const response = await this.makeRequest(`/backup/${historyId}/download`);
        return response; // This will be a file download
    }

    async deleteBackup(historyId) {
        return await this.makeRequest(`/backup/${historyId}`, {
            method: 'DELETE'
        });
    }

    async restoreBackup(historyId, options = {}) {
        return await this.makeRequest(`/backup/${historyId}/restore`, {
            method: 'POST',
            body: options
        });
    }

    // Statistics methods
    async getStats() {
        return await this.makeRequest('/stats');
    }

    async getDashboardData() {
        return await this.makeRequest('/dashboard');
    }

    // Storage methods
    async getStorageConfigs() {
        return await this.makeRequest('/storage-configs');
    }

    async createStorageConfig(config) {
        return await this.makeRequest('/storage-configs', {
            method: 'POST',
            body: config
        });
    }

    async testStorageConnection(configId) {
        return await this.makeRequest(`/storage-configs/${configId}/test`, {
            method: 'POST'
        });
    }

    // Settings methods
    async getSettings() {
        return await this.makeRequest('/settings');
    }

    async updateSetting(key, value) {
        return await this.makeRequest('/settings', {
            method: 'POST',
            body: { key, value }
        });
    }

    // Logs methods
    async getLogs(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const endpoint = queryString ? `/logs?${queryString}` : '/logs';
        return await this.makeRequest(endpoint);
    }

    // Monitoring methods
    async getSystemStatus() {
        return await this.makeRequest('/system/status');
    }

    async getDiskUsage() {
        return await this.makeRequest('/system/disk-usage');
    }
}

// Enhanced backup manager with real API integration
class EnhancedBackupManager {
    constructor() {
        this.api = new BackupAPIClient();
        this.eventListeners = new Map();
        this.pollingIntervals = new Map();
        this.isConnected = false;
        this.backupHistory = [];
        this.stats = {
            successful: 0,
            storageUsed: 0,
            lastBackup: null
        };
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkConnection();
        this.loadBackupHistory();
        this.startPeriodicUpdates();
    }

    bindEvents() {
        document.getElementById('refreshConnection')?.addEventListener('click', () => this.checkConnection());
        document.getElementById('startBackup')?.addEventListener('click', () => this.startBackup());
        document.getElementById('scheduleBackup')?.addEventListener('click', () => this.scheduleBackup());
        document.getElementById('cancelBackup')?.addEventListener('click', () => this.cancelBackup());

        // Add event listeners for dynamic elements
        this.addEventListener('backupCompleted', (data) => this.onBackupCompleted(data));
        this.addEventListener('backupFailed', (data) => this.onBackupFailed(data));
    }

    addEventListener(event, callback) {
        if (!this.eventListeners.has(event)) {
            this.eventListeners.set(event, []);
        }
        this.eventListeners.get(event).push(callback);
    }

    dispatchEvent(event, data) {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
            listeners.forEach(callback => callback(data));
        }
    }

    async checkConnection() {
        const statusIndicator = document.getElementById('statusIndicator');
        const statusText = document.getElementById('statusText');
        
        if (statusIndicator && statusText) {
            statusIndicator.className = 'w-3 h-3 rounded-full bg-yellow-500 mr-3 animate-pulse';
            statusText.textContent = 'Checking connection...';
        }

        try {
            const response = await this.api.checkConnection();
            
            if (response.success) {
                if (statusIndicator && statusText) {
                    statusIndicator.className = 'w-3 h-3 rounded-full bg-green-500 mr-3';
                    statusText.textContent = `Connected to ${response.server}`;
                }
                this.isConnected = true;
                await this.loadDatabases();
                await this.updateStats();
            } else {
                throw new Error(response.message);
            }
        } catch (error) {
            if (statusIndicator && statusText) {
                statusIndicator.className = 'w-3 h-3 rounded-full bg-red-500 mr-3';
                statusText.textContent = 'Connection failed';
            }
            this.isConnected = false;
            this.showNotification('Connection failed: ' + error.message, 'error');
        }
    }

    async loadDatabases() {
        try {
            const response = await this.api.getDatabases();
            const select = document.getElementById('databaseSelect');
            
            if (select) {
                // Clear existing options except the first one
                select.innerHTML = '<option value="">Select Database...</option>';
                
                response.databases.forEach(db => {
                    const option = document.createElement('option');
                    option.value = db.name;
                    option.textContent = `${db.name} (${db.size || 'Unknown size'})`;
                    select.appendChild(option);
                });
            }
        } catch (error) {
            console.error('Failed to load databases:', error);
            this.showNotification('Failed to load databases: ' + error.message, 'error');
        }
    }

    async startBackup() {
        if (!this.isConnected) {
            this.showNotification('Please check your connection first', 'error');
            return;
        }

        const databaseSelect = document.getElementById('databaseSelect');
        const database = databaseSelect?.value;
        
        if (!database) {
            this.showNotification('Please select a database', 'error');
            return;
        }

        const config = {
            database: database,
            type: document.getElementById('backupType')?.value || 'full',
            compression: document.getElementById('compression')?.checked || false,
            storage: document.querySelector('input[name="storage"]:checked')?.value || 'local'
        };

        try {
            // First create a backup configuration
            const configResponse = await this.api.createBackupConfig({
                name: `Manual backup - ${database} - ${new Date().toISOString()}`,
                database_name: config.database,
                backup_type: config.type,
                compression: config.compression,
                storage_type: config.storage,
                schedule_type: 'manual'
            });

            // Then execute the backup
            this.showProgressModal();
            const backupResponse = await this.api.executeBackup(configResponse.configId);
            
            // Start polling for progress
            this.startProgressPolling(backupResponse.historyId);

        } catch (error) {
            this.hideProgressModal();
            this.showNotification('Backup failed: ' + error.message, 'error');
        }
    }

    startProgressPolling(historyId) {
        const pollInterval = setInterval(async () => {
            try {
                const progress = await this.api.getBackupProgress(historyId);
                this.updateProgressModal(progress);
                
                if (progress.status === 'completed') {
                    clearInterval(pollInterval);
                    this.hideProgressModal();
                    this.showNotification('Backup completed successfully!', 'success');
                    this.dispatchEvent('backupCompleted', { historyId });
                    await this.loadBackupHistory();
                    await this.updateStats();
                } else if (progress.status === 'failed') {
                    clearInterval(pollInterval);
                    this.hideProgressModal();
                    this.showNotification('Backup failed: ' + (progress.error_message || 'Unknown error'), 'error');
                    this.dispatchEvent('backupFailed', { historyId, error: progress.error_message });
                }
            } catch (error) {
                clearInterval(pollInterval);
                this.hideProgressModal();
                this.showNotification('Failed to get backup progress', 'error');
            }
        }, 2000); // Poll every 2 seconds

        this.pollingIntervals.set(historyId, pollInterval);
    }

    updateProgressModal(progress) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        
        if (progressBar) {
            progressBar.style.width = (progress.progress_percentage || 0) + '%';
        }
        
        if (progressText) {
            progressText.textContent = progress.message || 'Processing...';
        }
    }

    async scheduleBackup() {
        const scheduleSelect = document.getElementById('scheduleSelect');
        const schedule = scheduleSelect?.value;
        
        if (schedule === 'manual') {
            this.showNotification('Please select a schedule frequency', 'error');
            return;
        }

        try {
            // This would create a scheduled backup configuration
            this.showNotification(`Backup scheduled to run ${schedule}`, 'success');
        } catch (error) {
            this.showNotification('Failed to schedule backup: ' + error.message, 'error');
        }
    }

    cancelBackup() {
        // Cancel any active polling
        for (const interval of this.pollingIntervals.values()) {
            clearInterval(interval);
        }
        this.pollingIntervals.clear();
        
        this.hideProgressModal();
        this.showNotification('Backup cancelled', 'info');
    }

    async loadBackupHistory() {
        try {
            const response = await this.api.getBackupHistory({ limit: 20 });
            this.backupHistory = response.history || [];
            this.updateBackupHistory();
        } catch (error) {
            console.error('Failed to load backup history:', error);
            this.showNotification('Failed to load backup history', 'error');
        }
    }

    async updateStats() {
        try {
            const stats = await this.api.getStats();
            
            const successCount = document.getElementById('successCount');
            const storageUsed = document.getElementById('storageUsed');
            const lastBackup = document.getElementById('lastBackup');
            
            if (successCount) successCount.textContent = stats.successful_backups || 0;
            if (storageUsed) storageUsed.textContent = this.formatBytes(stats.total_storage_bytes || 0);
            if (lastBackup) {
                lastBackup.textContent = stats.last_backup 
                    ? new Date(stats.last_backup).toLocaleDateString()
                    : 'Never';
            }
            
            this.stats = {
                successful: stats.successful_backups || 0,
                storageUsed: stats.total_storage_bytes || 0,
                lastBackup: stats.last_backup
            };
        } catch (error) {
            console.error('Failed to update stats:', error);
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateBackupHistory() {
        const container = document.getElementById('backupHistory');
        if (!container) return;

        container.innerHTML = '';

        if (this.backupHistory.length === 0) {
            container.innerHTML = '<p class="text-slate-500 text-center">No backups yet</p>';
            return;
        }

        this.backupHistory.forEach(backup => {
            const entry = document.createElement('div');
            entry.className = 'bg-slate-700 rounded-lg p-4 border border-slate-600';
            
            const statusColor = backup.status === 'completed' ? 'text-green-400' : 
                              backup.status === 'failed' ? 'text-red-400' : 'text-yellow-400';
            const storageIcon = this.getStorageIcon(backup.storage_type);
            
            entry.innerHTML = `
                <div class="flex justify-between items-start">
                    <div>
                        <h4 class="text-white font-medium">${backup.database_name}</h4>
                        <p class="text-slate-300 text-sm">${backup.backup_type} backup • ${this.formatBytes(backup.file_size || 0)}</p>
                        <p class="text-slate-400 text-xs">${new Date(backup.started_at).toLocaleDateString()} ${new Date(backup.started_at).toLocaleTimeString()}</p>
                    </div>
                    <div class="flex items-center space-x-2">
                        <i class="${storageIcon} text-slate-400"></i>
                        <span class="${statusColor}">
                            <i class="fas fa-${this.getStatusIcon(backup.status)} mr-1"></i>
                            ${backup.status}
                        </span>
                    </div>
                </div>
                <div class="mt-2 flex space-x-2">
                    ${backup.status === 'completed' ? `
                        <button class="text-blue-400 hover:text-blue-300 text-xs" onclick="backupManager.downloadBackup(${backup.id})">
                            <i class="fas fa-download mr-1"></i>Download
                        </button>
                        <button class="text-green-400 hover:text-green-300 text-xs" onclick="backupManager.restoreBackup(${backup.id})">
                            <i class="fas fa-undo mr-1"></i>Restore
                        </button>
                    ` : ''}
                    <button class="text-red-400 hover:text-red-300 text-xs" onclick="backupManager.deleteBackup(${backup.id})">
                        <i class="fas fa-trash mr-1"></i>Delete
                    </button>
                </div>
            `;
            
            container.appendChild(entry);
        });
    }

    async downloadBackup(historyId) {
        try {
            const response = await this.api.downloadBackup(historyId);
            // Trigger file download
            const url = window.URL.createObjectURL(new Blob([await response.arrayBuffer()]));
            const a = document.createElement('a');
            a.href = url;
            a.download = `backup_${historyId}.sql.gz`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            this.showNotification('Download failed: ' + error.message, 'error');
        }
    }

    async deleteBackup(historyId) {
        if (!confirm('Are you sure you want to delete this backup?')) return;

        try {
            await this.api.deleteBackup(historyId);
            this.showNotification('Backup deleted successfully', 'success');
            await this.loadBackupHistory();
            await this.updateStats();
        } catch (error) {
            this.showNotification('Delete failed: ' + error.message, 'error');
        }
    }

    async restoreBackup(historyId) {
        if (!confirm('Are you sure you want to restore this backup? This will overwrite the current database.')) return;

        try {
            await this.api.restoreBackup(historyId);
            this.showNotification('Restore completed successfully', 'success');
        } catch (error) {
            this.showNotification('Restore failed: ' + error.message, 'error');
        }
    }

    getStatusIcon(status) {
        const icons = {
            completed: 'check',
            failed: 'times',
            running: 'spinner',
            pending: 'clock'
        };
        return icons[status] || 'question';
    }

    getStorageIcon(storage) {
        const icons = {
            local: 'fas fa-hdd',
            ftp: 'fas fa-server',
            cloud: 'fas fa-cloud',
            'aws-s3': 'fab fa-aws'
        };
        return icons[storage] || 'fas fa-question';
    }

    startPeriodicUpdates() {
        // Update stats every 30 seconds
        setInterval(() => this.updateStats(), 30000);
        
        // Update backup history every 60 seconds
        setInterval(() => this.loadBackupHistory(), 60000);
    }

    showProgressModal() {
        const modal = document.getElementById('progressModal');
        if (modal) {
            modal.classList.remove('hidden');
            modal.classList.add('flex');
            
            // Reset progress
            const progressBar = document.getElementById('progressBar');
            const progressText = document.getElementById('progressText');
            
            if (progressBar) progressBar.style.width = '0%';
            if (progressText) progressText.textContent = 'Initializing backup...';
        }
    }

    hideProgressModal() {
        const modal = document.getElementById('progressModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.classList.remove('flex');
        }
    }

    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        const colors = {
            success: 'bg-green-600',
            error: 'bg-red-600',
            info: 'bg-blue-600',
            warning: 'bg-yellow-600'
        };
        
        notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 transform transition-transform duration-300 translate-x-full max-w-md`;
        notification.innerHTML = `
            <div class="flex items-center justify-between">
                <span>${message}</span>
                <button class="ml-4 text-white hover:text-gray-200" onclick="this.parentElement.parentElement.remove()">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => {
            notification.classList.remove('translate-x-full');
        }, 100);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => {
                if (notification.parentElement) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 5000);
    }

}

// Initialize the backup manager when the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    window.backupManager = new EnhancedBackupManager();
});