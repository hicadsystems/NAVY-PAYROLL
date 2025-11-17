// ==================== USER-SPECIFIC NOTIFICATION SYSTEM ====================
// Persistent notifications per user with backend synchronization and cross-tab sync

class UserNotificationSystem {
  constructor() {
    this.notifications = [];
    this.userId = this.getUserId();
    this.storageKey = `notifications_${this.userId}`;
    this.processingUrls = new Set();
    this.lastSyncTime = 0;
    this.syncInterval = null;
    this.animatingIds = new Set();
    this.tabId = `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.isProcessingFetch = false; // Flag to prevent duplicate processing
    this.init();
  }

  init() {
    console.log(`🆔 Tab ID: ${this.tabId}`);
    
    // DON'T load from localStorage - let backend be the source of truth
    // this.loadUserNotifications();
    
    // Listen for localStorage changes from other tabs
    this.setupCrossTabSync();
    
    // Sync with backend on initialization (this will load notifications)
    this.syncWithBackend();
    
    // Set up periodic sync every 30 seconds
    this.syncInterval = setInterval(() => {
      this.syncWithBackend();
    }, 30000);
    
    // Intercept fetch ONLY in the first/master tab
    this.setupFetchInterceptor();
    
    // On dashboard load, animate recent successful events
    this.animateRecentEvents();
    
    // Initial render (will be empty until backend sync completes)
    this.render();
  }

  getUserId() {
    return localStorage.getItem('user_id') || 'default';
  }

  // Setup cross-tab synchronization
  setupCrossTabSync() {
    window.addEventListener('storage', (e) => {
      // Only listen to changes to our notification storage key
      if (e.key === this.storageKey && e.newValue) {
        console.log(`📩 [${this.tabId}] Received notification update from another tab`);
        
        try {
          const newNotifications = JSON.parse(e.newValue);
          this.notifications = newNotifications;
          this.render();
        } catch (error) {
          console.error('Failed to parse notifications from storage event:', error);
        }
      }
    });
    
    console.log(`✅ Cross-tab sync enabled for tab ${this.tabId}`);
  }

  // Setup fetch interceptor with tab coordination
  setupFetchInterceptor() {
    const originalFetch = window.fetch;
    const self = this;
    
    window.fetch = async function(...args) {
      const response = await originalFetch(...args);
      
      const [url, options] = args;
      const method = options?.method?.toUpperCase();
      
      // Only process POST, PUT, and DELETE requests
      if (['POST', 'PUT', 'DELETE'].includes(method)) {
        // Use a unique key for this specific request
        const requestKey = `${method}-${url}-${Date.now()}`;
        
        // Check if ANY tab is already processing this
        const lockKey = `fetch-lock-${self.userId}`;
        const existingLock = localStorage.getItem(lockKey);
        
        if (existingLock) {
          const lockData = JSON.parse(existingLock);
          // If lock is less than 2 seconds old, skip
          if (Date.now() - lockData.timestamp < 2000) {
            console.log(`🔒 [${self.tabId}] Another tab is processing, skipping`);
            return response;
          }
        }
        
        // Acquire lock
        localStorage.setItem(lockKey, JSON.stringify({
          tabId: self.tabId,
          timestamp: Date.now()
        }));
        
        const clonedResponse = response.clone();
        
        try {
          const data = await clonedResponse.json();
          
          // Check if response has message field
          if (data.message) {
            const urlPath = new URL(url, window.location.origin).pathname;
            
            const event = {
              id: `event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: response.ok ? 'success' : 'error',
              message: data.message,
              timestamp: Date.now(),
              method: method,
              url: urlPath
            };
            
            console.log(`📝 [${self.tabId}] Captured event:`, event.message);
            
            // If success, remove similar error notifications
            if (event.type === 'success') {
              self.removeRelatedErrors(urlPath);
            }
            
            // Save event for animation
            self.saveEvent(event);
            
            // If on dashboard, animate
            const isDashboard = document.getElementById('notificationsList');
            if (isDashboard) {
              self.animateEventDrop(event);
            } else {
              // Not on dashboard, add directly to panel
              self.addToPanel(event);
            }
          }
        } catch (e) {
          // Response might not be JSON, ignore
        } finally {
          // Release lock after 500ms
          setTimeout(() => {
            const currentLock = localStorage.getItem(lockKey);
            if (currentLock) {
              const lockData = JSON.parse(currentLock);
              if (lockData.tabId === self.tabId) {
                localStorage.removeItem(lockKey);
              }
            }
          }, 500);
        }
      }
      
      return response;
    };
  }

  // Load user's notifications from localStorage
  loadUserNotifications() {
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      try {
        this.notifications = JSON.parse(stored);
        console.log(`📂 [${this.tabId}] Loaded ${this.notifications.length} notifications from localStorage`);
      } catch (e) {
        console.error('Failed to parse notifications:', e);
        this.notifications = [];
      }
    }
  }

  // Save user's notifications to localStorage
  saveUserNotifications() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.notifications));
      console.log(`💾 [${this.tabId}] Saved ${this.notifications.length} notifications to localStorage`);
    } catch (e) {
      console.error('Failed to save notifications:', e);
    }
  }

  // Sync notifications with backend
  async syncWithBackend() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.log('No token found, skipping backend sync');
        return;
      }
      
      console.log(`🔄 [${this.tabId}] Syncing with backend...`);
      
      const response = await fetch('/notifications', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Backend sync failed: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.notifications && Array.isArray(data.notifications)) {
        const backendNotifs = data.notifications;
        
        // Create a map of existing notification IDs
        const existingIds = new Set(this.notifications.map(n => n.id));
        const allIds = new Set([...existingIds, ...this.animatingIds]);
        
        // Add new notifications from backend
        let newCount = 0;
        backendNotifs.forEach(bn => {
          if (!allIds.has(bn.id)) {
            this.notifications.push(bn);
            newCount++;
          }
        });
        
        // Sort by timestamp (newest first)
        this.notifications.sort((a, b) => b.timestamp - a.timestamp);
        
        // Keep only last 100 notifications
        if (this.notifications.length > 100) {
          this.notifications = this.notifications.slice(0, 100);
        }
        
        // Save merged notifications to localStorage (this triggers storage event in other tabs)
        this.saveUserNotifications();
        
        if (newCount > 0) {
          console.log(`✅ [${this.tabId}] Synced ${newCount} new notifications from backend`);
          this.render();
        } else {
          console.log(`✅ [${this.tabId}] Backend sync complete - no new notifications`);
        }
        
        this.lastSyncTime = Date.now();
      }
    } catch (error) {
      console.error(`❌ [${this.tabId}] Failed to sync with backend:`, error);
    }
  }

  // Load recent events for animation
  loadRecentEvents() {
    const eventKey = `recentEvents_${this.userId}`;
    const stored = localStorage.getItem(eventKey);
    if (!stored) return [];
    
    try {
      const events = JSON.parse(stored);
      const now = Date.now();
      
      // Only keep events from last 5 minutes
      return events.filter(e => (now - e.timestamp) < 300000);
    } catch (e) {
      return [];
    }
  }

  // Save event for animation
  saveEvent(event) {
    const eventKey = `recentEvents_${this.userId}`;
    let events = this.loadRecentEvents();
    
    // Check if this exact event already exists
    const exists = events.some(e => e.id === event.id);
    if (exists) {
      console.log(`⏭️ [${this.tabId}] Event already saved, skipping:`, event.id);
      return;
    }
    
    events.push(event);
    
    // Keep only last 10 events
    if (events.length > 10) {
      events = events.slice(-10);
    }
    
    localStorage.setItem(eventKey, JSON.stringify(events));
    console.log(`💾 [${this.tabId}] Saved event for animation:`, event.message);
  }

  // Animate recent events when dashboard loads
  animateRecentEvents() {
    const recentEvents = this.loadRecentEvents();
    
    // Only run on dashboard page
    const isDashboard = document.getElementById('notificationsList') && 
                        document.querySelector('.frame-2');
    
    if (!isDashboard || recentEvents.length === 0) return;
    
    console.log(`🎬 [${this.tabId}] Animating ${recentEvents.length} recent events`);
    
    // Animate each event with delay
    recentEvents.forEach((event, index) => {
      setTimeout(() => {
        this.animateEventDrop(event);
      }, index * 800);
    });
    
    // Clear recent events after animation
    setTimeout(() => {
      const eventKey = `recentEvents_${this.userId}`;
      localStorage.removeItem(eventKey);
      console.log(`🧹 [${this.tabId}] Cleared recent events after animation`);
    }, recentEvents.length * 800 + 2000);
  }

  // Animate event dropping from top center to notification panel
  animateEventDrop(event) {
    const container = document.getElementById('notificationsList');
    if (!container) {
      console.log(`⏭️ [${this.tabId}] Not on dashboard, adding directly to panel`);
      this.addToPanel(event);
      return;
    }
    
    // Mark this notification as animating
    this.animatingIds.add(event.id);
    console.log(`🎬 [${this.tabId}] Starting animation for:`, event.message);
    
    // Create floating notification
    const floatingNotif = document.createElement('div');
    floatingNotif.className = 'fixed top-32 left-1/2 transform -translate-x-1/2 bg-white shadow-xl rounded-lg p-4 border-l-4 z-50 min-w-[280px] opacity-0';
    
    const borderColors = {
      success: 'border-green-500',
      warning: 'border-yellow-500',
      error: 'border-red-500',
      info: 'border-blue-500'
    };
    floatingNotif.classList.add(borderColors[event.type]);
    
    floatingNotif.innerHTML = `
      <div class="flex items-center gap-3">
        ${this.getIcon(event.type)}
        <div class="flex-1 text-sm font-semibold">${event.message}</div>
      </div>
    `;
    
    document.body.appendChild(floatingNotif);
    
    // Get notification panel position
    const panelRect = container.getBoundingClientRect();
    
    // Start animation after element is in DOM
    requestAnimationFrame(() => {
      floatingNotif.style.transition = 'opacity 0.3s ease-out';
      floatingNotif.style.opacity = '1';
      
      // Then animate to panel position
      setTimeout(() => {
        floatingNotif.style.transition = 'all 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        floatingNotif.style.top = `${panelRect.top + 80}px`;
        floatingNotif.style.left = `${panelRect.left + panelRect.width / 2}px`;
        floatingNotif.style.transform = 'translate(-50%, 0) scale(0.8)';
        floatingNotif.style.opacity = '0.5';
      }, 100);
    });
    
    // Wait for FULL animation to complete before adding to panel
    setTimeout(() => {
      floatingNotif.remove();
      console.log(`✅ [${this.tabId}] Animation complete, adding to panel:`, event.message);
      
      // Now add to panel ONLY after animation is done
      this.addToPanel(event);
      
      // Remove from animating set
      this.animatingIds.delete(event.id);
    }, 1500);
  }

  // Add notification to panel
  addToPanel(notification) {
    // Skip if this notification is currently animating
    if (this.animatingIds.has(notification.id)) {
      console.log(`⏭️ [${this.tabId}] Notification still animating, skipping:`, notification.id);
      return;
    }
    
    // Check if notification with same ID already exists
    const exists = this.notifications.some(n => n.id === notification.id);
    if (exists) {
      console.log(`⏭️ [${this.tabId}] Notification already exists, skipping:`, notification.id);
      return;
    }
    
    // Check if similar notification exists within last 60 seconds
    const existingIndex = this.notifications.findIndex(n => 
      n.message === notification.message && 
      (Date.now() - n.timestamp) < 60000
    );
    
    if (existingIndex !== -1) {
      const existing = this.notifications[existingIndex];
      existing.count = (existing.count || 1) + 1;
      existing.timestamp = Date.now();
      existing.lastOccurrence = notification.timestamp;
      
      console.log(`🔄 [${this.tabId}] Duplicate detected, count now: ${existing.count}`);
      
      // Move to top
      this.notifications.splice(existingIndex, 1);
      this.notifications.unshift(existing);
      
      this.saveUserNotifications();
      this.render();
      return;
    }
    
    console.log(`➕ [${this.tabId}] Adding new notification:`, notification.message);
    
    // Add to top of array
    this.notifications.unshift(notification);
    
    // Keep only last 100 notifications
    if (this.notifications.length > 100) {
      this.notifications = this.notifications.slice(0, 100);
    }
    
    // Save to localStorage (triggers storage event in other tabs)
    this.saveUserNotifications();
    
    // Re-render
    this.render();
  }

  // Remove error notifications when success happens for same action
  removeRelatedErrors(url) {
    const before = this.notifications.length;
    this.notifications = this.notifications.filter(n => {
      return n.type !== 'error' || !n.url || n.url !== url;
    });
    
    if (this.notifications.length < before) {
      console.log(`🧹 [${this.tabId}] Removed ${before - this.notifications.length} related error(s)`);
      this.saveUserNotifications();
    }
  }

  // Render notifications in container
  render() {
    const container = document.getElementById('notificationsList');
    if (!container) return;

    const displayNotifs = this.notifications.slice(0, 2);
    const unreadCount = this.notifications.length;

    if (displayNotifs.length === 0) {
      container.innerHTML = `
        <h4 class="text-xl font-bold text-navy mb-6 text-center">
          Notifications
        </h4>
        <div class="text-center text-gray-500 py-8">
          <i class="fas fa-bell-slash text-2xl mb-2"></i>
          <p class="text-xs">No notifications</p>
        </div>
      `;
      return;
    }

    const html = displayNotifs.map((notif, index) => {
      const icon = this.getIcon(notif.type);
      const timeAgo = this.getTimeAgo(notif.timestamp);
      const countBadge = notif.count > 1 ? `<span class="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-blue-500 rounded-full">${notif.count}x</span>` : '';
      
      return `
        <li class="flex items-center gap-3 notification-item cursor-pointer" 
            onclick="window.navigation.navigateToSection('notifications', 'All Notifications')"
            style="animation: slideIn 0.3s ease-out ${index * 0.1}s both">
          ${icon}
          <div class="flex-1">
            <div class="text-sm">${notif.message}${countBadge}</div>
            <div class="text-xs text-gray-400 mt-1">${timeAgo}</div>
          </div>
        </li>
      `;
    }).join('');

    container.innerHTML = `
      <div class="cursor-pointer" onclick="window.navigation.navigateToSection('notifications', 'All Notifications')">
        <h4 class="text-xl font-bold text-navy mb-4 text-center hover:text-blue-600 transition-colors">
          Notifications
          ${unreadCount > 4 ? `<span class="ml-2 inline-flex items-center justify-center px-2 py-1 text-xs font-bold leading-none text-white bg-red-500 rounded-full">${unreadCount}</span>` : ''}
        </h4>
      </div>
      <ul class="space-y-3">
        ${html}
      </ul>
      ${unreadCount > 4 ? `
        <div class="text-center mt-4">
          <button onclick="event.stopPropagation(); window.navigation.navigateToSection('notifications', 'All Notifications')" 
                  class="text-xs text-blue-600 hover:text-blue-800 font-semibold">
            View all ${unreadCount} notifications →
          </button>
        </div>
      ` : ''}
    `;
  }

  getTimeAgo(timestamp) {
    const mins = Math.floor((Date.now() - timestamp) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  getIcon(type) {
    const icons = {
      success: '<i class="fas fa-check-circle text-success" style="font-size: 20px"></i>',
      warning: '<i class="fas fa-exclamation-triangle text-yellow-500 text-xl"></i>',
      error: '<i class="fas fa-times-circle text-red-500 text-xl"></i>',
      info: '<i class="fas fa-info-circle text-blue-500 text-xl"></i>'
    };
    return icons[type] || icons.info;
  }

  async clearAll() {
    try {
      const token = localStorage.getItem('token');
      
      if (token) {
        const response = await fetch('/notifications/delete', {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          console.log(`✅ [${this.tabId}] Cleared notifications on backend`);
        }
      }
    } catch (error) {
      console.error('Failed to clear backend notifications:', error);
    }
    
    this.notifications = [];
    this.saveUserNotifications();
    this.render();
    console.log(`🧹 [${this.tabId}] All notifications cleared locally`);
  }

  add(type, message, action = null) {
    const notification = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: type,
      message: message,
      action: action,
      timestamp: Date.now()
    };
    
    this.addToPanel(notification);
  }

  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }
}

// CSS
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-20px); }
    to { opacity: 1; transform: translateX(0); }
  }
  .notification-item {
    transition: all 0.2s;
    padding: 0.5rem;
    margin: -0.5rem;
    border-radius: 0.5rem;
  }
  .notification-item:hover {
    background-color: rgba(251, 191, 36, 0.1);
  }
`;
document.head.appendChild(style);

// Global API
window.notificationSystem = null;
window.notify = {
  success(message, action = null) { window.notificationSystem?.add('success', message, action); },
  error(message, action = null) { window.notificationSystem?.add('error', message, action); },
  warning(message, action = null) { window.notificationSystem?.add('warning', message, action); },
  info(message, action = null) { window.notificationSystem?.add('info', message, action); },
  clearAll() { window.notificationSystem?.clearAll(); },
  sync() { window.notificationSystem?.syncWithBackend(); }
};

document.addEventListener('DOMContentLoaded', () => {
  window.notificationSystem = new UserNotificationSystem();
  console.log('✅ User Notification System ready with cross-tab sync');
});

window.addEventListener('beforeunload', () => {
  window.notificationSystem?.destroy();
});