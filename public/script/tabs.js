// Navigation handler for submenu items
class NavigationSystem {
  constructor() {
    this.currentSection = null;
    this.cache = new Map(); // Cache loaded content
    this.init();
  }

  init() {
    this.setupSubmenuNavigation();
    this.setupHistoryHandler();
    this.handleInitialLoad();
  }

  setupSubmenuNavigation() {
    document.querySelectorAll('.submenu ul li a[data-section]').forEach(link => {
      link.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const sectionId = link.getAttribute('data-section');
        const sectionName = link.textContent.trim();
        
        if (sectionId) {
          // Close all submenus first
          if (typeof closeAll === 'function') {
            closeAll();
          }
          
          // Hide mobile menu
          this.hideMobileMenu();
          
          // Show loading state
          this.showLoadingState(sectionName);
          
          // Navigate to section
          await this.navigateToSection(sectionId, sectionName);
        }
      });
    });
  }

async hideMobileMenu(link) {
  if (window.innerWidth <= 1023) {
    const sidebar = document.querySelector('#sidebar');

    if (link) {
      const sectionId = link.getAttribute('data-section');
      const sectionName = link.textContent.trim();

      if (sectionId) {
        // Close all submenus first
        if (typeof closeAll === 'function') {
          closeAll();
        }

        // Show loading state
        this.showLoadingState(sectionName);

        // Navigate to section
        await this.navigateToSection(sectionId, sectionName);
      }
    }

    // Finally hide sidebar
    if (sidebar) {
      sidebar.style.display = 'none';
    }
  }
}


  showLoadingState(sectionName) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-transparent rounded-xl p-6 shadow-sm border border-gray-100">
            <div class="flex items-center justify-center py-12">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-400 mr-3"></div>
              <span class="text-gray-600">Loading...</span>
            </div>
          </div>
        </div>
      `;
    }
  }

  async navigateToSection(sectionId, sectionName) {
    try {
      // Check if content exists on current page
      const existingElement = document.querySelector(`#${sectionId}`);
      if (existingElement) {
        existingElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // Load content from file
      const content = await this.loadSectionContent(sectionId, sectionName);
      this.renderSection(sectionName, content);
      this.updateHistory(sectionId, sectionName);
      this.currentSection = sectionId;

    } catch (error) {
      this.showErrorState(sectionName, error);
    }
  }

  async loadSectionContent(sectionId, sectionName) {
    // Check cache first
    if (this.cache.has(sectionId)) {
      return this.cache.get(sectionId);
    }

    // Try to load from multiple possible locations
    const possiblePaths = [
      `sections/${sectionId}.html`,
      `components/${sectionId}.html`,
      `pages/${sectionId}.html`
    ];

    for (const path of possiblePaths) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const content = await response.text();
          // Cache the content
          this.cache.set(sectionId, content);
          return content;
        }
      } catch (error) {
        console.warn(`Failed to load from ${path}:`, error);
      }
    }

    // If no file found, return default content
    return this.getDefaultContent(sectionId, sectionName);
  }

  getDefaultContent(sectionId, sectionName) {
    return `
      <div class="text-center py-12">
        <div class="max-w-md mx-auto">
          <div class="mb-4">
            <svg class="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 class="text-lg font-medium text-gray-900 mb-2">${sectionName}</h3>
          <p class="text-gray-600 mb-4">This section is under development.</p>
          <p class="text-sm text-gray-500">Section ID: ${sectionId}</p>
          <div class="mt-6">
            <p class="text-sm text-gray-600">Expected file locations:</p>
            <ul class="text-xs text-gray-500 mt-2 space-y-1">
              <li>sections/${sectionId}.html</li>
              <li>components/${sectionId}.html</li>
              <li>pages/${sectionId}.html</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  }

  renderSection(sectionName, content) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-white/10 rounded-xl shadow-lg border border-gray-100">
            ${content}
          </div>
        </div>
      `;
      
      // Initialize any scripts in the loaded content
      this.initializeLoadedScripts();
    }
  }

  initializeLoadedScripts() {
    // Execute any scripts in the newly loaded content
    const scripts = document.querySelectorAll('main script');
    scripts.forEach(script => {
      if (script.src) {
        // External script
        const newScript = document.createElement('script');
        newScript.src = script.src;
        newScript.onload = () => console.log(`Loaded script: ${script.src}`);
        document.head.appendChild(newScript);
      } else {
        // Inline script
        try {
          eval(script.textContent);
        } catch (error) {
          console.error('Error executing inline script:', error);
        }
      }
    });
  }

  showErrorState(sectionName, error) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-white rounded-xl p-6 shadow-sm border border-gray-100">
            <div class="text-center py-12">
              <div class="text-red-500 mb-4">
                <svg class="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h3 class="text-lg font-medium text-gray-900 mb-2">Failed to Load Content</h3>
              <p class="text-gray-600 mb-4">${error.message}</p>
              <button onclick="window.navigation.navigateToSection('${this.currentSection}', '${sectionName}')" 
                      class="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                Retry
              </button>
            </div>
          </div>
        </div>
      `;
    }
  }

  updateHistory(sectionId, sectionName) {
    document.title = `HICAD — ${sectionName}`;
    window.history.pushState(
      { section: sectionName, sectionId }, 
      '', 
      `#${sectionId}`
    );
  }

  setupHistoryHandler() {
    window.addEventListener('popstate', (event) => {
      if (event.state && event.state.section && event.state.sectionId) {
        this.navigateToSection(
          event.state.sectionId.replace('#', ''), 
          event.state.section
        );
      }
    });
  }

  handleInitialLoad() {
    // Handle initial page load with hash
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      const sectionId = hash.substring(1);
      const sectionName = this.getSectionNameFromId(sectionId);
      this.navigateToSection(sectionId, sectionName);
    }
  }

  getSectionNameFromId(sectionId) {
    // Convert kebab-case to Title Case
    return sectionId
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // Public method to clear cache
  clearCache() {
    this.cache.clear();
    console.log('Navigation cache cleared');
  }

  // Public method to preload sections
  async preloadSections(sectionIds) {
    const loadPromises = sectionIds.map(sectionId => 
      this.loadSectionContent(sectionId, this.getSectionNameFromId(sectionId))
    );
    
    try {
      await Promise.all(loadPromises);
      console.log('Sections preloaded:', sectionIds);
    } catch (error) {
      console.warn('Some sections failed to preload:', error);
    }
  }
}

// Initialize navigation system when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  // Make navigation system globally accessible
  window.navigation = new NavigationSystem();
});

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = NavigationSystem;
}