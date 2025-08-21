
tailwind.config = {
  theme: {
    extend: {
      maxWidth: { 'layout': '1440px' },
      colors: {
      'navy': '#1e40af',
      'warning': '#f6b409',
      'success': '#047014'
      },
      screens: {
      'xs': '640px',   // triggers at 640px
      'custom': '766px' // triggers at 766px
      },
      boxShadow: {
      'custom': '0 2px 5px 0 rgba(0,0,0,0.08)',
      },
    }
  }
};

// keep sidebar toggle for small screens (does not change layout structure on lg)
const btn = document.getElementById('menu-toggle');
const sidebarEl = document.getElementById('sidebar');
const mainContainer = document.querySelector('main'); // or your main content container

let sidebarOverlay = null;

function createSidebarOverlay() {
  if (sidebarOverlay) return sidebarOverlay;
  sidebarOverlay = document.createElement('div');
  sidebarOverlay.className = 'sidebar-overlay';
  sidebarOverlay.style.zIndex = '30'; // Lower than submenu overlay (40)
  sidebarOverlay.addEventListener('click', closeSidebar);
  return sidebarOverlay;
}

function removeSidebarOverlay() {
  if (sidebarOverlay) {
    sidebarOverlay.remove();
    sidebarOverlay = null;
  }
}

function closeSidebar() {
  if (window.innerWidth < 1024) {
    // Mobile behavior
    sidebarEl.classList.remove('sidebar-visible');
    removeSidebarOverlay();
    document.body.classList.remove('no-scroll');
  } else {
    // Desktop behavior - just hide sidebar and add centering class
    sidebarEl.classList.add('desktop-hidden');
    document.body.classList.add('sidebar-closed');
    document.body.classList.remove('sidebar-open');
  }
}

function openSidebar() {
  if (window.innerWidth < 1024) {
    // Mobile behavior
    sidebarEl.classList.add('sidebar-visible');
    document.body.appendChild(createSidebarOverlay());
    document.body.classList.add('no-scroll');
  } else {
    // Desktop behavior - show sidebar and remove centering
    sidebarEl.classList.remove('desktop-hidden');
    document.body.classList.add('sidebar-open');
    document.body.classList.remove('sidebar-closed');
  }
}

function toggleSidebar() {
  const isOpen = window.innerWidth < 1024 
    ? sidebarEl.classList.contains('sidebar-visible')
    : !sidebarEl.classList.contains('desktop-hidden');
    
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

btn?.addEventListener('click', toggleSidebar);

// Handle window resize
window.addEventListener('resize', () => {
  removeSidebarOverlay();
  document.body.classList.remove('no-scroll');
  
  if (window.innerWidth >= 1024) {
    sidebarEl.classList.remove('sidebar-visible');
    // Reset to default desktop state
    sidebarEl.classList.remove('desktop-hidden');
    mainContainer?.classList.add('sidebar-open');
    mainContainer?.classList.remove('sidebar-closed');
  }
});

// Toggle submenu on click (touch support) and close when clicking outside.
const submenuButtons = document.querySelectorAll('.has-submenu');
const sidebar = document.getElementById('sidebar');

let overlay = null;
function createOverlay(){
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'submenu-overlay';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.5)',
    zIndex: 40,
    cursor: 'pointer'
  });
  overlay.addEventListener('click', closeAll);
  return overlay;
}
function removeOverlay(){
  if (overlay) {
    overlay.remove();
  }
}

function calcBaseLeft(){
  if (sidebar) {
    const sRect = sidebar.getBoundingClientRect();
    return Math.round(sRect.right + 3);
  }
  return 8;
}

function positionSubmenu(btn, submenu){
  submenu.style.position = 'fixed';
  submenu.style.zIndex = 50;
  submenu.style.maxWidth = '320px';
  submenu.style.whiteSpace = 'nowrap';

  // Make sure submenu is attached to body for correct z-index
  if (submenu.parentNode !== document.body) {
    document.body.appendChild(submenu);
  }

  const rect = btn.getBoundingClientRect();
  
if (window.innerWidth < 600) {
  submenu.style.left = '80px';
  submenu.style.top = (rect.bottom - 5) + 'px';
  submenu.style.maxWidth = (window.innerWidth - 90) + 'px'; // More room for scroll
  submenu.style.maxHeight = '35vh'; // Limit height
  submenu.style.overflowY = 'auto'; // Enable scrolling
  submenu.style.overflowX = 'hidden';
  submenu.style.whiteSpace = 'normal';
  submenu.style.background = 'white'; // Ensure background for scrolling
  return;
}

  // Desktop/tablet positioning (to the side)
  let left = calcBaseLeft();
  let top = Math.max(8, Math.round(rect.top));

  // Pre-calculate height without making visible
  const tempDiv = submenu.cloneNode(true);
  tempDiv.style.position = 'absolute';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '-9999px';
  tempDiv.style.visibility = 'hidden';
  tempDiv.classList.remove('opacity-0', 'invisible', 'hidden');
  tempDiv.classList.add('opacity-100', 'visible', 'block');
  document.body.appendChild(tempDiv);
  
  const submenuHeight = tempDiv.offsetHeight;
  document.body.removeChild(tempDiv);

  // Adjust position if it would go off screen
  if (top + submenuHeight > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - submenuHeight - 8);
  }

  // Set final position
  submenu.style.left = left + 'px';
  submenu.style.top = top + 'px';
}

function showSubmenu(btn, submenu, openedBy='hover'){
  btn.dataset.openedBy = openedBy;
  positionSubmenu(btn, submenu);

  submenu.classList.remove('opacity-0','invisible','hidden');
  submenu.classList.add('opacity-100','visible','block');

  btn.setAttribute('aria-expanded','true');
  btn.querySelector('img')?.classList.add('rotate-180');

  if (openedBy === 'click') {
    const ov = createOverlay();
    document.body.appendChild(ov);
    document.body.classList.add('no-scroll'); // Lock scroll
  }
}

function hideSubmenu(btn, submenu){
  if (btn.dataset.openedBy === 'click') {
    removeOverlay();
    document.body.classList.remove('no-scroll'); // Unlock scroll
  }

  submenu.classList.add('opacity-0','invisible','hidden');
  submenu.classList.remove('opacity-100','visible','block');
  submenu.style.left = '';
  submenu.style.top  = '';
  submenu.style.zIndex = '';

  btn.setAttribute('aria-expanded','false');
  btn.querySelector('img')?.classList.remove('rotate-180');
  delete btn.dataset.openedBy;
}

function closeAll(){
  document.querySelectorAll('.has-submenu[aria-expanded="true"]').forEach(b=>{
    const s = document.body.querySelector('.submenu.opacity-100');
    if (s) {
      hideSubmenu(b, s);
    }
  });
}

submenuButtons.forEach(btn=>{
  const li = btn.closest('li');
  const submenu = li.querySelector('.submenu');
  if (!submenu) return;

  btn.classList.add('cursor-pointer');
  submenu.classList.add('cursor-pointer');

  submenu.addEventListener('click', e => e.stopPropagation());

  btn.addEventListener('click', e=>{
    e.preventDefault(); e.stopPropagation();
    const isOpen = btn.getAttribute('aria-expanded') === 'true';
    const openedBy = btn.dataset.openedBy;

    if (isOpen && openedBy === 'hover') {
      btn.dataset.openedBy = 'click';
      const ov = createOverlay();
      document.body.appendChild(ov);
      document.body.classList.add('no-scroll');
      return;
    }
    if (isOpen && openedBy === 'click') {
      hideSubmenu(btn, submenu);
      return;
    }
    closeAll();
    showSubmenu(btn, submenu, 'click');
  });

  // Hover open
  li.addEventListener('mouseenter', ()=>{
    if (window.matchMedia('(hover: hover)').matches) {
      if (btn.dataset.openedBy !== 'click') showSubmenu(btn, submenu, 'hover');
    }
  });

  // Hover leave
  const maybeCloseHover = ()=>{
    if (!window.matchMedia('(hover: hover)').matches) return;
    setTimeout(()=>{
      if (btn.dataset.openedBy === 'click') return;
      if (!li.matches(':hover') && !submenu.matches(':hover')) hideSubmenu(btn, submenu);
    }, 200); // Increased timeout for better user experience
  };
  li.addEventListener('mouseleave', maybeCloseHover);
  submenu.addEventListener('mouseleave', maybeCloseHover);
});

document.addEventListener('click', e=>{
  if (!e.target.closest('.submenu') && !e.target.closest('.has-submenu')) closeAll();
});
document.addEventListener('keydown', e=>{
  if (e.key === 'Escape') closeAll();
});

let t;
function repositionOpen(){
  document.querySelectorAll('.has-submenu[aria-expanded="true"]').forEach(b=>{
    const s = document.body.querySelector('.submenu.opacity-100');
    if (s) positionSubmenu(b, s);
  });
}
window.addEventListener('resize', ()=>{ clearTimeout(t); t = setTimeout(repositionOpen, 120); });
window.addEventListener('scroll', ()=> repositionOpen(), { passive: true });


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
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mr-3"></div>
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
      `sections/${sectionId}.html`
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
        <div data-section="${this.currentSection}" class="mt-6">
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