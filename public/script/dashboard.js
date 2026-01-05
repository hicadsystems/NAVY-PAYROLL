tailwind.config = {
  theme: {
    extend: {
      //darkMode: 'class',
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
      keyframes: {
        "grow-up": { "0%": { height: "0" }, "100%": { height: "100%" } },
        "grow-down": { "0%": { height: "0", bottom: "0" }, "100%": { height: "100%" } },
        "expand": { "0%": { width: "0" }, "100%": { width: "100%" } },
      },
      animation: {
        "grow-up": "grow-up 0.8s ease-out forwards",
        "grow-down": "grow-down 0.8s ease-out forwards",
        "expand": "expand 0.8s ease-out forwards",
      }
    }
  }
};

(function() {
  // Prevent any rendering until state is ready
  const width = window.innerWidth;
  
  window.addEventListener('DOMContentLoaded', function() {
    const body = document.body;
    const sidebar = document.getElementById('sidebar');
    
    // Set sidebar state immediately
    if (width <= 1200 && width >= 1024) {
      sidebar?.classList.add('desktop-hidden');
      body.classList.add('sidebar-closed');
    } else if (width > 1200) {
      body.classList.add('sidebar-open');
    }
    
    // Hide dashboard content if we have a hash (navigating to section)
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.style.display = 'none'; // Hide dashboard immediately
      }
    }
    
    // Make visible with single animation
    requestAnimationFrame(() => {
      document.documentElement.classList.add('ready');
      body.classList.add('initialized');
    });
  });
})();

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

// Save sidebar state (lg screens only)
async function saveSidebarState() {
  if (window.innerWidth < 1200) return; // Only save on lg screens
  
  const isCollapsed = sidebarEl.classList.contains('desktop-hidden');
  
  try {
    const token = localStorage.getItem('token');
    await fetch('/preferences/sidebar/save', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sidebarCollapsed: isCollapsed })
    });
  } catch (error) {
    console.error('Failed to save sidebar state:', error);
  }
}

// Load sidebar state on page load
async function loadSidebarState() {
  const width = window.innerWidth;
  
  // Only apply saved state on full desktop (>= 1200px)
  if (width < 1200) {
    console.log('Not full desktop - skipping saved state');
    
    if (width >= 1024) {
      // Icon mode: force collapsed
      sidebarEl.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
    }
    return;
  }
  
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/preferences/sidebar', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    console.log('Loaded sidebar state:', data);
    
    if (data.success) {
      if (data.sidebarCollapsed) {
        // User prefers collapsed
        sidebarEl.classList.add('desktop-hidden');
        document.body.classList.add('sidebar-closed');
        document.body.classList.remove('sidebar-open');
        console.log('✅ Applied collapsed state');
      } else {
        // User prefers expanded
        sidebarEl.classList.remove('desktop-hidden');
        document.body.classList.add('sidebar-open');
        document.body.classList.remove('sidebar-closed');
        console.log('✅ Applied expanded state');
      }
    } else {
      // No saved state: default to expanded on 1200+
      sidebarEl.classList.remove('desktop-hidden');
      document.body.classList.add('sidebar-open');
      document.body.classList.remove('sidebar-closed');
    }
  } catch (error) {
    console.error('Failed to load sidebar state:', error);
  }
}

// Modify toggleSidebar to save state:
function toggleSidebar() {
  const isOpen = window.innerWidth < 1024 
    ? sidebarEl.classList.contains('sidebar-visible')
    : !sidebarEl.classList.contains('desktop-hidden');
    
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
  
  // Save state for lg screens only
  if (window.innerWidth >= 1200) {
    saveSidebarState();
  }
}

btn?.addEventListener('click', toggleSidebar);

// Handle window resize with debouncing
let resizeTimeout;
let previousWidth = window.innerWidth;

window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(async () => {
    const currentWidth = window.innerWidth;
    const wasLargeScreen = previousWidth >= 1200;
    const isLargeScreen = currentWidth >= 1200;  
    const wasIconMode = previousWidth >= 1024 && previousWidth < 1200;
    const isIconMode = currentWidth >= 1024 && currentWidth < 1200;
    
    removeSidebarOverlay();
    document.body.classList.remove('no-scroll');
    
    if (previousWidth < 1024 && currentWidth >= 1024) {
      // Moving FROM mobile TO desktop (1024+)
      console.log('Transitioning from mobile to desktop');
      sidebarEl.classList.remove('sidebar-visible');
      
      if (currentWidth < 1200) {
        // Entering icon mode (1024-1199)
        console.log('Entering icon mode (1024-1199)');
        sidebarEl.classList.add('desktop-hidden');
        document.body.classList.add('sidebar-closed');
        document.body.classList.remove('sidebar-open');
      } else {
        // Entering full desktop (1200+)
        await loadSidebarState();
      }
      
    } else if (previousWidth >= 1024 && currentWidth < 1024) {
      // Moving FROM desktop TO mobile
      console.log('Transitioning from desktop to mobile');
      
      // Reset desktop classes
      sidebarEl.classList.remove('desktop-hidden');
      document.body.classList.remove('sidebar-closed', 'sidebar-open');
      sidebarEl.classList.remove('sidebar-visible');
      
    } else if (!wasLargeScreen && isLargeScreen) {
      // Moving FROM icon mode (1024-1199) TO full desktop (1200+)
      console.log('Transitioning from icon mode to full desktop');
      await loadSidebarState();
      
    } else if (wasLargeScreen && !isLargeScreen && isIconMode) {
      // Moving FROM full desktop (1200+) TO icon mode (1024-1199)
      console.log('Transitioning from full desktop to icon mode');
      
      // Force icon mode
      sidebarEl.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
      
    } else if (isLargeScreen) {
      // Staying on full desktop (1200+) - maintain current state
      const isCollapsed = sidebarEl.classList.contains('desktop-hidden');
      
      if (isCollapsed) {
        document.body.classList.add('sidebar-closed');
        document.body.classList.remove('sidebar-open');
      } else {
        document.body.classList.add('sidebar-open');
        document.body.classList.remove('sidebar-closed');
      }
    } else if (isIconMode) {
      // Staying in icon mode (1024-1199) - always collapsed
      sidebarEl.classList.add('desktop-hidden');
      document.body.classList.add('sidebar-closed');
      document.body.classList.remove('sidebar-open');
    }
    
    previousWidth = currentWidth;
  }, 150);
});

// Initialize sidebar state on page load
document.addEventListener('DOMContentLoaded', async () => {
  const width = window.innerWidth;
  
  if (width >= 1200) {
    // Full desktop: load saved state
    await loadSidebarState();
  } else if (width >= 1024) {
    // Icon mode: force collapsed
    sidebarEl?.classList.add('desktop-hidden');
    document.body.classList.add('sidebar-closed');
    document.body.classList.remove('sidebar-open');
  } else {
    // Mobile/tablet: ensure sidebar is hidden
    sidebarEl?.classList.remove('sidebar-visible');
    document.body.classList.remove('sidebar-closed', 'sidebar-open');
  }
  
  // Store initial width
  previousWidth = width;
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
  
  if (window.innerWidth < 768) {
    // Mobile: scrollable submenu
    submenu.style.left = '80px';
    submenu.style.top = (rect.bottom - 5) + 'px';
    submenu.style.maxWidth = (window.innerWidth - 90) + 'px';
    submenu.style.maxHeight = '35vh';
    submenu.style.overflowY = 'auto';
    submenu.style.overflowX = 'hidden';
    submenu.style.whiteSpace = 'normal';
    submenu.style.background = 'white';
    return;
  }

  // Desktop/tablet: clean up mobile styles
  submenu.style.maxHeight = '';
  submenu.style.overflowY = '';
  submenu.style.overflowX = '';
  submenu.style.whiteSpace = 'nowrap';
  submenu.style.background = '';

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
window.addEventListener('resize', ()=>{ 
  clearTimeout(t); 
  t = setTimeout(() => {
    repositionOpen();
    
    // Clean up mobile-specific submenu styles on larger screens
    if (window.innerWidth >= 768) {
      document.querySelectorAll('.submenu').forEach(submenu => {
        submenu.style.maxHeight = '';
        submenu.style.overflowY = '';
        submenu.style.overflowX = '';
        submenu.style.whiteSpace = '';
        submenu.style.background = '';
      });
    }
  }, 150); 
});
window.addEventListener('scroll', ()=> repositionOpen(), { passive: true });

// Figure out the current time of day
function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 16) return 'Afternoon';
  if (hour >= 16 && hour < 21) return 'Evening';
  return 'Night';
}

// Get logged-in user from JWT token
function getLoggedInUser() {
  try {
    const token = localStorage.getItem("token");
    if (!token) {
      // Fallback to localStorage for backward compatibility
      return {
        user_id: localStorage.getItem("user_id"),
        full_name: localStorage.getItem("full_name"),
        role: localStorage.getItem("role"),
        primary_class: localStorage.getItem("class"),
        current_class: localStorage.getItem("class")
      };
    }

    // ✅ Decode JWT token to get user info including current_class
    const payload = JSON.parse(atob(token.split('.')[1]));
    
    return {
      user_id: payload.user_id,
      full_name: payload.full_name,
      role: payload.role,
      primary_class: payload.primary_class,
      current_class: payload.current_class || payload.primary_class // ✅ Use current_class from token
    };
  } catch (error) {
    console.error('Error decoding token:', error);
    // Fallback to localStorage
    return {
      user_id: localStorage.getItem("user_id"),
      full_name: localStorage.getItem("full_name"),
      role: localStorage.getItem("role"),
      primary_class: localStorage.getItem("class"),
      current_class: localStorage.getItem("class")
    };
  }
}

// Cache for class mappings
let classMapping = {};

// Load class mappings from backend endpoint
async function loadClassMappings() {
  try {
    const token = localStorage.getItem('token');

    const response = await fetch('/dbclasses', {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
    }); 

    const data = await response.json();

    // ✅ Create mapping from db_name → display_name
    classMapping = {};
    data.classes.forEach(cls => {
      classMapping[cls.dbName] = cls.display;
    });

    console.log('✅ Class mappings loaded:', classMapping);

  } catch (error) {
    console.error('❌ Failed to load class mappings:', error);
  }
}

// Update greeting message
function updateGreeting() {
  const greetingElement = document.getElementById('dynamicGreeting');
  const workingClassElement = document.getElementById('payrollClassName');
  if (!greetingElement && !workingClassElement) return; // Only run if element exists

  const user = getLoggedInUser();
  const timeOfDay = getTimeOfDay();

  // ✅ Use current_class from JWT token (the database they switched to)
  const effectiveClass = user.current_class;
  const userClass = classMapping[effectiveClass] || effectiveClass || 'OFFICERS';

  // Default to "User" if no login info
  const userName = user?.full_name || user?.user_id || 'User';

  const greeting = `Good ${timeOfDay} ${userName}, welcome to ${userClass} payroll`;
  greetingElement.textContent = greeting;
  workingClassElement.textContent = userClass;

  console.log('📊 Dashboard greeting updated:', {
    user: userName,
    primaryClass: user.primary_class,
    currentClass: user.current_class,
    displayClass: userClass
  });
}

// Update current time display
function updateCurrentTime() {
  const timeElement = document.getElementById('currentTime');
  if (!timeElement) return;

  const now = new Date();
  const timeString = now.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  timeElement.textContent = timeString;
}

// ✅ Update function for when payroll class is switched
window.updateDashboardGreeting = function(newClassName) {
  console.log('🔄 Updating dashboard greeting for new class:', newClassName);
  
  // Reload user info from updated token
  const user = getLoggedInUser();
  if (user) {
    updateGreeting();
  }
};

// ✅ Listen for payroll class switch events
document.addEventListener('payrollClassFocused', (event) => {
  console.log('🎯 Payroll class focused event received:', event.detail);
  updateGreeting();
});

// Get current payroll period from database
async function getCurrentPayrollPeriod() {
  try {
    const token = localStorage.getItem('token');
    const user = getLoggedInUser();
    const dbName = user.current_class;
    
    const response = await fetch('/payroll-period', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (data.success) {
      // Update the payroll period display
      const periodElement = document.querySelector('#current-payroll-period');
      if (periodElement) {
        const monthNames = ['Jan', 'Feb', 'March', 'April', 'May', 'June',
                           'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
        const monthName = monthNames[data.month - 1] || 'Unknown';
        periodElement.textContent = `${monthName} ${data.year}`;
      }
      
      return { month: data.month, year: data.year };
    }
  } catch (error) {
    console.error('Failed to load payroll period:', error);
  }
}

// Init only on dashboard pages
(async function initDashboard() {
  if (document.getElementById('dynamicGreeting')) {
    await loadClassMappings();   // ✅ wait for mapping to load
    updateGreeting();
    updateCurrentTime();

    setInterval(updateCurrentTime, 1000);  // Update time every second
    setInterval(updateGreeting, 60000);    // Refresh greeting every minute (to catch token updates)
    await getCurrentPayrollPeriod();  // Load current payroll period
  }
})();


// SIMPLE SUBSUBMENU FUNCTIONALITY - Direct approach
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM loaded, setting up subsubmenus...');
  
  // Wait a bit to ensure all other scripts have loaded
  setTimeout(function() {
    setupSubsubmenus();
  }, 100);
});

function setupSubsubmenus() {
  console.log('Setting up subsubmenus...');
  
  // Find all toggle buttons
  const toggleButtons = document.querySelectorAll('.toggle-subsubmenu');
  console.log('Found toggle buttons:', toggleButtons.length);
  
  toggleButtons.forEach((button, index) => {
    console.log(`Setting up button ${index + 1}`);
    
    // Remove any existing listeners
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    // Add click listener to the new button
    newButton.addEventListener('click', function(e) {
      console.log('Subsubmenu button clicked!');
      e.preventDefault();
      e.stopPropagation();
      
      const li = this.closest('.has-subsubmenu');
      const subsubmenu = li.querySelector('.subsubmenu');
      
      if (subsubmenu) {
        const isHidden = subsubmenu.classList.contains('hidden');
        console.log('Current state - hidden:', isHidden);
        
        if (isHidden) {
          subsubmenu.classList.remove('hidden');
          this.textContent = '▾';
          console.log('Opened subsubmenu');
        } else {
          subsubmenu.classList.add('hidden');
          this.textContent = '▸';
          console.log('Closed subsubmenu');
        }
      } else {
        console.log('No subsubmenu found');
      }
    });
  });
  
  // Also handle clicking on the div container (not just the button)
  const containers = document.querySelectorAll('.has-subsubmenu > div');
  console.log('Found containers:', containers.length);
  
  containers.forEach((container, index) => {
    console.log(`Setting up container ${index + 1}`);
    
    container.addEventListener('click', function(e) {
      // Only handle if we didn't click the button directly
      if (!e.target.classList.contains('toggle-subsubmenu')) {
        console.log('Container clicked!');
        e.preventDefault();
        e.stopPropagation();
        
        const li = this.closest('.has-subsubmenu');
        const subsubmenu = li.querySelector('.subsubmenu');
        const button = li.querySelector('.toggle-subsubmenu');
        
        if (subsubmenu && button) {
          const isHidden = subsubmenu.classList.contains('hidden');
          console.log('Current state - hidden:', isHidden);
          
          if (isHidden) {
            subsubmenu.classList.remove('hidden');
            button.textContent = '▾';
            console.log('Opened subsubmenu via container');
          } else {
            subsubmenu.classList.add('hidden');
            button.textContent = '▸';
            console.log('Closed subsubmenu via container');
          }
        }
      }
    });
  });
  
  console.log('Subsubmenu setup complete');
}

/*const rolePermissions = {
  "data entry": {
    base: ["reference-tables", "data-entry", "utilities"], 
    "-": ["payments-deductions"], 
    "+": []
  },
  "operator": {
    inherit: "data entry",
    "+": ["personel-profile"],
    "-": []
  },
  "processor": {
    inherit: "operator",
    "+": ["payroll-calculations", "reports"],
    "-": []
  },
  "manager": {
    inherit: "processor",
    "+": ["administration"],
    "-": ["create-user"]
  },
  "hicad": {
    base: ["*"],
    "+": [], 
    "-": []
  }
};

function resolvePermissions(role) {
  const seen = new Set();
  const inheritanceChain = [];
  
  // Build inheritance chain from role to root
  let current = role;
  while (current && !seen.has(current)) {
    seen.add(current);
    inheritanceChain.push(current);
    const cfg = rolePermissions[current];
    current = cfg ? cfg.inherit : null;
  }
  
  // Process inheritance chain from root to target role
  let finalPermissions = [];
  let finalExclusions = [];
  
  // Start with base permissions from the most specific role (first in chain)
  const targetRole = rolePermissions[inheritanceChain[0]];
  if (targetRole && targetRole.base) {
    finalPermissions.push(...targetRole.base);
  }
  
  // Apply inheritance from parent to child (reverse order)
  for (let i = inheritanceChain.length - 1; i >= 0; i--) {
    const roleName = inheritanceChain[i];
    const cfg = rolePermissions[roleName];
    
    if (cfg) {
      // Add permissions from + array
      if (cfg["+"]) {
        finalPermissions.push(...cfg["+"]);
      }
      
      // Add exclusions from - array
      if (cfg["-"]) {
        finalExclusions.push(...cfg["-"]);
      }
    }
  }
  
  // Remove duplicates
  finalPermissions = [...new Set(finalPermissions)];
  finalExclusions = [...new Set(finalExclusions)];
  
  // Remove excluded permissions from final permissions
  finalPermissions = finalPermissions.filter(perm => !finalExclusions.includes(perm));
  
  return {
    permissions: finalPermissions,
    exclusions: finalExclusions,
    inheritanceChain: inheritanceChain
  };
}

// Store role in memory instead of localStorage
let currentUserRole = "";

function setUserRole(role) {
  currentUserRole = role.toLowerCase();
  console.log(`Setting user role to: ${role}`);
  applyPermissions();
}

function applyPermissions() {
  const resolved = resolvePermissions(currentUserRole);
  console.log(`Applying permissions for ${currentUserRole}:`, resolved);
  
  // Hide all menus first
  document.querySelectorAll("[data-menu], [data-section], [data-submenu]").forEach(element => {
    element.style.display = "none";
  });
  
  // Handle wildcard permissions (for hicad role)
  if (resolved.permissions.includes("*")) {
    document.querySelectorAll("[data-menu], [data-section], [data-submenu]").forEach(element => {
      element.style.display = "block";
    });
    return;
  }
  
  // Show permitted elements
  resolved.permissions.forEach(permission => {
    // Show menu items
    const menuElements = document.querySelectorAll(`[data-menu="${permission}"]`);
    menuElements.forEach(el => el.style.display = "block");
    
    // Show section items
    const sectionElements = document.querySelectorAll(`[data-section="${permission}"]`);
    sectionElements.forEach(el => {
      el.style.display = "block";
      // Also show the parent container if it exists
      if (el.parentElement) {
        el.parentElement.style.display = "block";
      }
    });
    
    // Show submenu items
    const submenuElements = document.querySelectorAll(`[data-submenu="${permission}"]`);
    submenuElements.forEach(el => el.style.display = "block");
  });
  
  // Explicitly hide excluded elements (this ensures exclusions override permissions)
  resolved.exclusions.forEach(exclusion => {
    const excludedElements = document.querySelectorAll(
      `[data-menu="${exclusion}"], [data-section="${exclusion}"], [data-submenu="${exclusion}"]`
    );
    excludedElements.forEach(el => el.style.display = "none");
  });
}

// Testing function to verify permissions work correctly
function testPermissions() {
  const roles = ["data entry", "operator", "processor", "manager", "hicad"];
  
  roles.forEach(role => {
    const resolved = resolvePermissions(role);
    console.log(`\n${role.toUpperCase()} Role:`);
    console.log("  Inheritance Chain:", resolved.inheritanceChain);
    console.log("  Final Permissions:", resolved.permissions);
    console.log("  Exclusions:", resolved.exclusions);
  });
}

// Backend integration example
async function initializeUserPermissions() {
  try {
    // Replace with your actual API endpoint
    const response = await fetch('/api/user/role');
    const userData = await response.json();
    setUserRole(userData.role);
  } catch (error) {
    console.error('Failed to fetch user role:', error);
    // Fallback to most restrictive role
    setUserRole("data entry");
  }
}

// Initialize when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  setUserRole("operator"); 
   testPermissions();
});

// Example function to change roles dynamically (for testing)
function switchRole(newRole) {
  setUserRole(newRole);
}*/


// Navigation handler for submenu items
class NavigationSystem {
  constructor() {
    this.currentSection = null;
    this.cache = new Map(); // Cache loaded content
    this.state = {}; // State for section navigation
    this.isNavigating = false; // Prevent race conditions
    this.navigationHistory = [];
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
          // CHECK EDIT MODE BEFORE SHOWING LOADING STATE
          const isEditMode = localStorage.getItem('isEditMode') === 'true';
          const currentHash = window.location.hash.substring(1);
          
          // If clicking add-personnel while already in edit mode, keep edit mode
          if (sectionId === 'add-personnel' && isEditMode && currentHash === 'add-personnel') {
            // Already on add-personnel in edit mode, do nothing
            return;
          }
          
          if (isEditMode && currentHash === 'add-personnel' && sectionId !== 'add-personnel') {
            const confirmed = confirm(
              'You are currently editing a personnel record. ' +
              'Any unsaved changes will be lost. Do you want to continue?'
            );
            
            if (!confirmed) {
              console.log('Navigation cancelled by user');
              return;
            }
            
            // User confirmed, clean up edit state
            localStorage.removeItem('editing_employee_id');
            localStorage.removeItem('isEditMode');
            localStorage.removeItem('navigatedFromCurrentPersonnel');
            
            if (window.PersonnelAPI?.setCreateMode) {
              window.PersonnelAPI.setCreateMode();
            }
          }
          
          // Close all submenus
          if (typeof closeAll === 'function') {
            closeAll();
          }
          
          // Hide mobile menu
          this.hideMobileMenu();
          
          // Show loading state (use "Edit Personnel" if in edit mode and going to add-personnel)
          const displayName = (sectionId === 'add-personnel' && isEditMode) 
            ? 'Edit Personnel' 
            : sectionName;
          this.showLoadingState(displayName);
          
          // Navigate to section
          await this.navigateToSection(sectionId, displayName);
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
        closeSidebar();
        removeOverlay();
        removeSidebarOverlay();
      }

      if (sidebarOverlay) {
        removeOverlay();
        removeSidebarOverlay();
      }
    }
  }

  showLoadingState(sectionName) {
    const mainContent = document.querySelector('main');
    if (mainContent) {
      // Prevent flicker by checking if already showing loading
      const isAlreadyLoading = mainContent.querySelector('.animate-grow-up');
      if (isAlreadyLoading) return;
      
      // Hide immediately
      mainContent.style.opacity = '0';
      mainContent.style.transition = 'none';
      
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-transparent rounded-xl shadow-sm border border-gray-100"> 
            <div class="flex items-center justify-center p-6"> 
              <div class="relative w-10 h-10 mr-3">
                <div class="absolute left-1 w-[6px] bg-blue-600 rounded animate-grow-up"></div>

                <div class="absolute right-1 w-[6px] bg-blue-600 rounded animate-grow-down [animation-delay:0.3s]"></div>

                <div class="absolute top-1/2 left-1 h-[6px] bg-blue-600 rounded animate-expand [animation-delay:0.6s] -translate-y-1/2"></div>
              </div>
              <span class="text-gray-600">Loading...</span>
            </div>
          </div>
        </div>
      `;
            
      window.scrollTo({ top: 0, behavior: 'instant' });
      
      // Fade in the loading state
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mainContent.style.transition = 'opacity 0.2s ease';
          mainContent.style.opacity = '1';
        });
      });
    }
  }

  async navigateToSection(sectionId, sectionName, state = {}) {
    // Prevent duplicate navigation
    if (this.isNavigating) {
      console.log('Navigation already in progress');
      return;
    }

    try {
      this.isNavigating = true;

      // Check if content exists on current page
      const existingElement = document.querySelector(`#${sectionId}`);
      if (existingElement) {
        existingElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      // Store current section in history before navigating
      if (this.currentSection && this.currentSection !== sectionId) {
        // Get the section name from history state or derive it
        const currentSectionName = this.getSectionNameFromId(this.currentSection);
        this.navigationHistory.push({
          sectionId: this.currentSection,
          sectionName: currentSectionName
        });
        console.log('Added to history:', this.currentSection);
      }

      // Store the navigation state
      this.state = state;

      // Load content from file
      const content = await this.loadSectionContent(sectionId, sectionName);
      this.renderSection(sectionName, content);
      this.updateHistory(sectionId, sectionName);
      this.currentSection = sectionId;

      // Initialize any dynamic behavior based on state
      if (sectionId === 'add-personnel' && state.isEditMode) {
        const batchButton = document.getElementById('tab-batch');
        if (batchButton) {
          batchButton.disabled = true;
          batchButton.classList.add('opacity-50', 'cursor-not-allowed');
          batchButton.classList.remove('hover:bg-blue-600');
        }
      }

    } catch (error) {
      this.showErrorState(sectionName, error);
    } finally {
      this.isNavigating = false;
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
      // Show main if it was hidden
      mainContent.style.display = 'block';
      mainContent.style.opacity = '0';
      
      mainContent.innerHTML = `
        <div class="mt-6">
          <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
          <div class="bg-white/10 rounded-xl shadow-lg border border-gray-100"> 
            ${content}
          </div>

          <div class="my-6">
            <button 
              onclick="window.navigation.goBack()" 
              class="bg-yellow-500 hover:bg-red-500 text-white font-medium px-6 py-2 rounded-lg transition-colors duration-200 ease-in-out shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" 
                  d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Return
            </button>
          </div>
        </div>
      `;

      window.scrollTo({ top: 0, behavior: 'instant' });
      this.initializeLoadedScripts();

      // Smooth fade-in with animation
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mainContent.style.transition = 'opacity 0.3s ease';
          mainContent.style.opacity = '1';

          // Apply the fade-up animation
          const container = mainContent.querySelector('.mt-6');
          if (container) {
            container.classList.add('animate-fade-up');

            // Remove fade-up transform after animation completes
            container.addEventListener('animationend', (e) => {
              if (e.animationName === 'fadeInUp' || e.animationName === 'fadeInUpInner') {
                container.classList.remove('animate-fade-up');
                container.style.transform = 'none'; // ensure no transform remains
              }
            }, { once: true });
          }
        });
      });
    }
  }

  // New method to go back to previous section
  goBack() {
    console.log('Going back, history length:', this.navigationHistory.length);
    
    if (this.navigationHistory.length > 0) {
      // Get the last section from history
      const previousSection = this.navigationHistory.pop();
      console.log('Returning to:', previousSection);
      
      // Navigate back to previous section (don't add to history again)
      this.navigateToSectionWithoutHistory(previousSection.sectionId, previousSection.sectionName);
    } else {
      // No history, return to dashboard
      console.log('No history, returning to dashboard');
      this.returnToDashboard();
    }
  }

  // Navigate without adding to history (for back navigation)
  async navigateToSectionWithoutHistory(sectionId, sectionName, state = {}) {
    if (this.isNavigating) {
      console.log('Navigation already in progress');
      return;
    }

    try {
      this.isNavigating = true;

      // Store the navigation state
      this.state = state;

      // Load content from file
      const content = await this.loadSectionContent(sectionId, sectionName);
      this.renderSection(sectionName, content);
      this.updateHistory(sectionId, sectionName);
      this.currentSection = sectionId;

      // UPDATE MENU HIGHLIGHTING
      if (window.menuHighlighter) {
        window.menuHighlighter.setActiveSection(sectionId);
      }

      // DISPATCH EVENT FOR MENU HIGHLIGHTER
      const event = new CustomEvent('sectionLoaded', {
        detail: { sectionId, sectionName }
      });
      document.dispatchEvent(event);

    } catch (error) {
      this.showErrorState(sectionName, error);
    } finally {
      this.isNavigating = false;
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

          <!-- Return to Dashboard Button -->
          <div class="mb-4">
            <button 
              onclick="window.navigation.goBack()" 
              class="bg-yellow-500 hover:bg-red-500 text-white font-medium px-6 py-2 rounded-lg transition-colors duration-200 ease-in-out shadow-md hover:shadow-lg flex items-center gap-2"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
              Return to Dashboard
            </button>
          </div>
        </div>
      `;
    }
  }

  // New method to handle return to dashboard
  returnToDashboard() {
    // Clear current section
    this.currentSection = null;
    
    // Clear navigation history
    this.navigationHistory = [];

    // CLEAR MENU HIGHLIGHTING
    if (window.menuHighlighter) {
      window.menuHighlighter.clearAllActiveStates();
    }
    
    // Update URL to remove hash
    window.history.pushState({}, '', window.location.pathname);
    
    // Clear main content or redirect to dashboard
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.innerHTML = `
        <div class="mt-6">
          <div class="text-center py-12">
            <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">Dashboard</h2>
            <p class="text-gray-600">Welcome back! Select a section from the sidebar to get started.</p>
          </div>
        </div>
      `;
     window.location.href = 'dashboard.html';
    }
    
    // Update page title
    document.title = 'HICAD — Dashboard';
  }

  updateHistory(sectionId, sectionName) {
    document.title = `HICAD — ${sectionName}`;
    // Store both sectionId and original sectionName in history state
    window.history.pushState(
      { 
        section: sectionName, 
        sectionId: sectionId 
      }, 
      '', 
      `#${sectionId}`
    );
  }

  setupHistoryHandler() {
    window.addEventListener('popstate', (event) => {
      if (event.state && event.state.section && event.state.sectionId) {
        // Use the original section name stored in history state
        this.navigateToSectionWithoutHistory(
          event.state.sectionId, 
          event.state.section  // Use original section name, not converted from ID
        );
      } else {
        // Handle back to dashboard
        this.returnToDashboard();
      }
    });
  }

  handleInitialLoad() {
    // Handle initial page load with hash
    const hash = window.location.hash;
    if (hash && hash.length > 1) {
      const sectionId = hash.substring(1);
      
      // Hide dashboard content IMMEDIATELY before any rendering
      const mainContent = document.querySelector('main');
      if (mainContent) {
        mainContent.style.opacity = '0';
        mainContent.style.display = 'none';
      }
      
      // Get section name
      let sectionName = null;
      if (window.history.state && window.history.state.section) {
        sectionName = window.history.state.section;
      } else {
        const linkElement = document.querySelector(`a[data-section="${sectionId}"]`);
        if (linkElement) {
          sectionName = linkElement.textContent.trim();
        } else {
          sectionName = this.getSectionNameFromId(sectionId);
        }
      }
      
      // Load section immediately
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

// Dashboard stats update
async function updateDashboardStats() {
  try {
    // Get payroll status
    const response = await fetch('stats/2025/10', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      }
    });

    const result = await response.json();
    
    if (result.success) {
      // Update stats cards
      document.getElementById('pendingApproval').textContent = result.data.total_employees || '0';
      document.getElementById('nominalProcessed').textContent = result.data.total_employees || '0';
      
      // Update notifications based on status
      updateNotifications(result.data);
    }
  } catch (error) {
    console.error('Error updating dashboard:', error);
  }
}


// ==================== QUICK ACCESS MANAGEMENT SYSTEM ==================== //

class QuickAccessManager {
  constructor() {
    this.userId = this.getUserId();
    this.userRole = this.getUserRole();
    this.quickAccessItems = [];
    this.draggedIndex = null;
    this.longPressTimer = null;
    this.isDraggingEnabled = false;
    this.isActuallyDragging = false;
    this.longPressActivated = false;
    this.touchStartPos = null;
    
    // Define position-based colors (these stay fixed per position)
    this.positionColors = [
      'bg-[#8CB5F8]/20',  // Position 0 - Blue
      'bg-[#FBBF24]/20',  // Position 1 - Yellow
      'bg-[#FBBF24]/20',  // Position 2 - Yellow
      'bg-[#8CB5F8]/20',  // Position 3 - Blue
      'bg-[#8CB5F8]/20',  // Position 4 - Blue
      'bg-[#FBBF24]/20'   // Position 5 - Yellow
    ];
    
    // Define all available quick access options
    this.availableOptions = {
      'database-backup': {
        id: 'database-backup',
        label: 'Database Backup',
        section: 'database-backup',
        title: 'Database Backup'
      },
      'save-payroll-files': {
        id: 'save-payroll-files',
        label: 'Save Payroll Files',
        section: 'save-payroll-files',
        title: 'Save Payroll Files'
      },
      'add-personnel': {
        id: 'add-personnel',
        label: 'Add New Personnel',
        section: 'add-personnel',
        title: 'Add New Personnel'
      },
      'monthly-yearly-processing': {
        id: 'monthly-yearly-processing',
        label: 'Process Month End',
        section: 'monthly-yearly-processing',
        title: 'Month End Processing'
      },
      'pay-slips': {
        id: 'pay-slips',
        label: 'Pay Slips',
        section: 'pay-slips',
        title: 'Pay Slips'
      },
      'payments-deductions': {
        id: 'payments-deductions',
        label: 'Payment/Deduction',
        section: 'payments-deductions',
        title: 'Payments/Deductions'
      },
      'current-personnel': {
        id: 'current-personnel',
        label: 'Current Personnel',
        section: 'current-personnel',
        title: 'Current Personnel'
      },
      'payroll-calculations': {
        id: 'payroll-calculations',
        label: 'Payroll Calculations',
        section: 'payroll-calculations',
        title: 'Payroll Calculations'
      },
      'payments-by-bank': {
        id: 'payments-by-bank',
        label: 'Payments by Bank',
        section: 'payments-by-bank',
        title: 'Payments by Bank'
      },
      'master-file-update': {
        id: 'master-file-update',
        label: 'Master File Update',
        section: 'master-file-update',
        title: 'Master File Update'
      },
      'role-management': {
        id: 'role-management',
        label: 'Role Management',
        section: 'role-management',
        title: 'Role Management'
      },
      'create-user': {
        id: 'create-user',
        label: 'Create User',
        section: 'create-user',
        title: 'Create User'
      },
      'control-user': {
        id: 'control-user',
        label: 'Control User',
        section: 'control-user',
        title: 'Control User'
      },
      'old-personnel': {
        id: 'old-personnel',
        label: 'Old Personnel',
        section: 'old-personnel',
        title: 'Old Personnel'
      },
      'calculation-reports': {
        id: 'calculation-reports',
        label: 'Calculation Reports',
        section: 'calculation-reports',
        title: 'Calculation Reports'
      },
      'company-profile': {
        id: 'company-profile',
        label: 'Company Profile',
        section: 'company-profile',
        title: 'Company Profile'
      }
    };
    
    // Define default quick access items per role
    this.roleDefaults = {
      'admin': [
        'role-management',
        'create-user',
        'database-backup',
        'monthly-yearly-processing',
        'payroll-calculations',
        'pay-slips'
      ],
      'manager': [
        'pay-slips',
        'monthly-yearly-processing',
        'payroll-calculations',
        'payments-by-bank',
        'current-personnel',
        'add-personnel'
      ],
      'accountant': [
        'payments-deductions',
        'pay-slips',
        'payments-by-bank',
        'payroll-calculations',
        'save-payroll-files',
        'monthly-yearly-processing'
      ],
      'hr': [
        'add-personnel',
        'current-personnel',
        'payments-deductions',
        'pay-slips',
        'master-file-update',
        'save-payroll-files'
      ],
      'user': [
        'pay-slips',
        'current-personnel',
        'payments-deductions',
        'save-payroll-files',
        'payroll-calculations',
        'payments-by-bank'
      ]
    };
    
    // Define which sections each role can access
    this.rolePermissions = {
      'HICAD': 'all',
      'manager': [
        'pay-slips',
        'monthly-yearly-processing',
        'payroll-calculations',
        'payments-by-bank',
        'current-personnel',
        'add-personnel',
        'old-personnel',
        'payments-deductions',
        'calculation-reports',
        'save-payroll-files',
        'master-file-update'
      ],
      'accountant': [
        'payments-deductions',
        'pay-slips',
        'payments-by-bank',
        'payroll-calculations',
        'save-payroll-files',
        'monthly-yearly-processing',
        'calculation-reports',
        'current-personnel',
        'master-file-update'
      ],
      'hr': [
        'add-personnel',
        'current-personnel',
        'old-personnel',
        'payments-deductions',
        'pay-slips',
        'master-file-update',
        'save-payroll-files',
        'company-profile'
      ],
      'user': [
        'pay-slips',
        'current-personnel',
        'payments-deductions',
        'save-payroll-files',
        'payroll-calculations',
        'payments-by-bank'
      ]
    };
    
    this.init();
  }
  
  getUserId() {
    return localStorage.getItem('user_id') || 'default';
  }

  getUserRole() {
    return localStorage.getItem('user_role') || 'HICAD';
  }
  
  getAvailableOptionsForRole() {
    const permissions = this.rolePermissions[this.userRole];
    
    if (permissions === 'all') {
      return this.availableOptions;
    }
    
    const filtered = {};
    Object.entries(this.availableOptions).forEach(([id, option]) => {
      if (permissions.includes(id)) {
        filtered[id] = option;
      }
    });
    
    return filtered;
  }
  
  async init() {
    await this.loadQuickAccess();
    this.render();
    this.createModal();
  }
  
  async loadQuickAccess() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        this.useRoleDefaults();
        return;
      }
      
      const response = await fetch('/preferences', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.quickAccess && Array.isArray(data.quickAccess) && data.quickAccess.length === 6) {
          this.quickAccessItems = data.quickAccess;
          console.log('📂 Loaded custom quick access from backend');
        } else {
          this.useRoleDefaults();
        }
      } else {
        this.useRoleDefaults();
      }
    } catch (error) {
      console.error('Failed to load quick access:', error);
      this.useRoleDefaults();
    }
  }
  
  useRoleDefaults() {
    const defaults = this.roleDefaults[this.userRole] || this.roleDefaults['user'];
    this.quickAccessItems = [...defaults];
    console.log(`🎯 Using default quick access for role: ${this.userRole}`);
  }
  
  async saveQuickAccess() {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      
      const response = await fetch('/preferences/save', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          quickAccess: this.quickAccessItems
        })
      });
      
      if (response.ok) {
        console.log('💾 Saved quick access preferences to backend');
      }
    } catch (error) {
      console.error('Failed to save quick access:', error);
    }
  }
  
  createModal() {
    const modal = document.createElement('div');
    modal.id = 'quickAccessModal';
    modal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm hidden items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-xl w-full mx-4">
        <div class="bg-navy p-4 text-white flex items-center justify-between rounded-t-xl">
          <h3 class="text-lg font-bold">Customize Quick Access</h3>
          <button 
            onclick="window.quickAccessManager.resetToDefaults()" 
            class="text-md font-bold text-yellow-300 hover:underline transition-colors">
            <i class="fa-solid fa-arrow-rotate-left mr-1"></i> Reset
          </button>
        </div>
        
        <div class="p-4">
          <div id="modalQuickAccessGrid" class="grid grid-cols-2 gap-3"></div>
        </div>
        
        <div class="bg-gray-50 p-3 flex justify-end gap-2 border-t rounded-b-xl">
          <button 
            onclick="window.quickAccessManager.closeModal()" 
            class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold transition-colors">
            Cancel
          </button>
          <button 
            onclick="window.quickAccessManager.saveAndClose()" 
            class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors">
            Save
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Create custom alert modal
    this.createAlertModal();
  }
  
  createAlertModal() {
    const alertModal = document.createElement('div');
    alertModal.id = 'quickAccessAlertModal';
    alertModal.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm hidden items-center justify-center z-50';
    alertModal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4">
        <div class="p-6">
          <div class="flex items-center gap-3 mb-4">
            <div class="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
              <i class="fa-solid fa-circle-info text-blue-600 text-xl"></i>
            </div>
            <h3 class="text-lg font-bold text-navy" id="alertModalTitle">Confirm</h3>
          </div>
          <p class="text-gray-700 mb-6" id="alertModalMessage"></p>
          <div class="flex justify-end gap-2">
            <button 
              onclick="window.quickAccessManager.closeAlertModal(false)" 
              class="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold transition-colors">
              Cancel
            </button>
            <button 
              onclick="window.quickAccessManager.closeAlertModal(true)" 
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors">
              Confirm
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(alertModal);
  }
  
  showAlert(message, title = 'Confirm') {
    return new Promise((resolve) => {
      this.alertResolve = resolve;
      const modal = document.getElementById('quickAccessAlertModal');
      const titleEl = document.getElementById('alertModalTitle');
      const messageEl = document.getElementById('alertModalMessage');
      
      if (modal && titleEl && messageEl) {
        titleEl.textContent = title;
        messageEl.textContent = message;
        modal.classList.remove('hidden');
        modal.classList.add('flex');
      }
    });
  }
  
  closeAlertModal(result) {
    const modal = document.getElementById('quickAccessAlertModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    if (this.alertResolve) {
      this.alertResolve(result);
      this.alertResolve = null;
    }
  }
  
  openModal() {
    const modal = document.getElementById('quickAccessModal');
    if (!modal) return;
    
    this.renderModalContent();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
  
  closeModal() {
    const modal = document.getElementById('quickAccessModal');
    if (!modal) return;
    
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    
    this.loadQuickAccess().then(() => this.render());
  }
  
  async saveAndClose() {
    await this.saveQuickAccess();
    const modal = document.getElementById('quickAccessModal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }
    this.render();
  }
  
  renderModalContent() {
    const grid = document.getElementById('modalQuickAccessGrid');
    if (!grid) return;
    
    grid.innerHTML = this.quickAccessItems.map((itemId, index) => {
      const option = this.availableOptions[itemId];
      if (!option) return '';
      
      return this.renderModalItem(option, index);
    }).join('');
  }
  
  renderModalItem(option, index) {
    const color = this.positionColors[index];
    const roleOptions = this.getAvailableOptionsForRole();
    
    const availableForSwap = Object.entries(roleOptions)
      .filter(([id]) => !this.quickAccessItems.includes(id) || id === option.id)
      .map(([id, opt]) => `
        <option value="${id}" ${id === option.id ? 'selected' : ''}>
          ${opt.label}
        </option>
      `).join('');
    
    return `
      <div 
        class="relative ${color} p-3 rounded-lg shadow-sm border-2 border-transparent hover:border-blue-400 cursor-move transition-all modal-drag-item"
        draggable="true"
        data-index="${index}"
        ondragstart="window.quickAccessManager.handleModalDragStart(event, ${index})"
        ondragover="window.quickAccessManager.handleModalDragOver(event)"
        ondrop="window.quickAccessManager.handleModalDrop(event, ${index})"
        ondragend="window.quickAccessManager.handleModalDragEnd(event)"
        ondragleave="window.quickAccessManager.handleModalDragLeave(event)">
        
        <div class="flex flex-col gap-2">
          <div class="text-center text-sm font-semibold text-gray-700">
            ${option.label}
          </div>
          
          <select 
            onchange="window.quickAccessManager.replaceItemInModal(${index}, this.value)"
            class="w-full px-2 py-1.5 text-xs border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white cursor-pointer"
            onclick="event.stopPropagation()">
            ${availableForSwap}
          </select>
        </div>
      </div>
    `;
  }
  
  // ========== FIXED DASHBOARD DRAG HANDLERS ==========
  
  clearLongPressTimer() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }
  
  resetDragState() {
    this.clearLongPressTimer();
    this.isDraggingEnabled = false;
    this.isActuallyDragging = false;
    this.draggedIndex = null;
    
    // Reset all button styles
    document.querySelectorAll('.quick-access-btn').forEach(btn => {
      btn.setAttribute('draggable', 'false');
      btn.style.cursor = '';
      btn.style.opacity = '';
      btn.style.transform = '';
      btn.style.borderColor = '';
      btn.style.borderWidth = '';
      btn.style.borderStyle = '';
    });
  }
  
  // ========== LONG PRESS HANDLERS (SIMPLIFIED) ==========
  
  handleMouseDown(index, event) {
    const button = event.currentTarget;
    
    // Clear any existing timer
    this.clearLongPressTimer();
    
    console.log('🖱️ Mouse/Touch down on button', index);
    
    // Start long press timer
    this.longPressTimer = setTimeout(() => {
      console.log('⏰ Long press activated for button', index);
      
      this.isDraggingEnabled = true;
      this.draggedIndex = index;
      
      // Enable draggable attribute (this is the key!)
      button.setAttribute('draggable', 'true');
      
      // Visual feedback
      button.style.cursor = 'grabbing';
      button.style.opacity = '0.7';
      button.style.transform = 'scale(1.05)';
      
      // Haptic feedback
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      console.log('✅ Button is now draggable - drag it to another position');
    }, 500);
  }
  
  handleMouseUp(event) {
    console.log('🖱️ Mouse/Touch up');
    
    // Clear the timer
    this.clearLongPressTimer();
    
    // If drag was enabled, prevent the click
    if (this.isDraggingEnabled && !this.isActuallyDragging) {
      event.preventDefault();
      event.stopPropagation();
      console.log('🚫 Click prevented - drag mode was enabled');
    }
    
    // Small delay before resetting
    setTimeout(() => {
      if (!this.isActuallyDragging) {
        this.resetDragState();
      }
    }, 150);
  }
  
  // ========== DASHBOARD DRAG HANDLERS (SIMPLIFIED - MODAL STYLE) ==========
  
  handleDashboardDragStart(index, event) {
    // For dashboard, we need long press first
    if (!this.isDraggingEnabled || this.draggedIndex !== index) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    
    console.log('✅ Dashboard drag starting for button', index);
    this.isActuallyDragging = true;
    this.draggedIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.currentTarget.style.opacity = '0.4';
  }
  
  handleDashboardDragOver(event) {
    // Allow drop only when dragging is active
    if (!this.isActuallyDragging) return;
    
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.style.borderColor = '#3B82F6';
    event.currentTarget.style.borderWidth = '2px';
    event.currentTarget.style.borderStyle = 'dashed';
  }
  
  handleDashboardDragLeave(event) {
    event.currentTarget.style.borderColor = '';
    event.currentTarget.style.borderWidth = '';
    event.currentTarget.style.borderStyle = '';
  }
  
  handleDashboardDrop(targetIndex, event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = '';
    event.currentTarget.style.borderWidth = '';
    event.currentTarget.style.borderStyle = '';
    
    if (this.draggedIndex === null || this.draggedIndex === targetIndex) {
      this.draggedIndex = null;
      return;
    }
    
    console.log('📦 Swapping:', this.draggedIndex, '<->', targetIndex);
    
    // Proper array swap (same as modal)
    const items = [...this.quickAccessItems];
    const temp = items[this.draggedIndex];
    items[this.draggedIndex] = items[targetIndex];
    items[targetIndex] = temp;
    
    this.quickAccessItems = items;
    this.draggedIndex = null;
    
    // Save and re-render
    this.saveQuickAccess();
    this.render();
  }
  
  handleDashboardDragEnd(event) {
    console.log('🏁 Dashboard drag ended');
    event.currentTarget.style.opacity = '1';
    
    // Clean up all buttons
    document.querySelectorAll('.quick-access-btn').forEach(el => {
      el.style.borderColor = '';
      el.style.borderWidth = '';
      el.style.borderStyle = '';
      el.style.opacity = '';
    });
    
    // Reset drag state
    setTimeout(() => {
      this.resetDragState();
    }, 100);
  }
  
  handleButtonClick(section, title, event) {
    // Only navigate if drag mode wasn't active
    if (this.isDraggingEnabled || this.isActuallyDragging) {
      console.log('🚫 Navigation blocked - drag mode was active');
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    
    console.log('🔗 Navigating to:', section);
    if (window.navigation && window.navigation.navigateToSection) {
      window.navigation.navigateToSection(section, title);
    }
    return true;
  }
  
  // ========== MODAL DRAG HANDLERS (unchanged) ==========
  
  handleModalDragStart(event, index) {
    this.draggedIndex = index;
    event.dataTransfer.effectAllowed = 'move';
    event.currentTarget.style.opacity = '0.4';
  }
  
  handleModalDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.style.borderColor = '#3B82F6';
    event.currentTarget.style.borderWidth = '2px';
  }
  
  handleModalDragLeave(event) {
    event.currentTarget.style.borderColor = 'transparent';
  }
  
  handleModalDragEnd(event) {
    event.currentTarget.style.opacity = '1';
    document.querySelectorAll('.modal-drag-item').forEach(el => {
      el.style.borderColor = 'transparent';
    });
  }
  
  handleModalDrop(event, targetIndex) {
    event.preventDefault();
    event.currentTarget.style.borderColor = 'transparent';
    
    if (this.draggedIndex === null || this.draggedIndex === targetIndex) {
      this.draggedIndex = null;
      return;
    }
    
    const items = [...this.quickAccessItems];
    const temp = items[this.draggedIndex];
    items[this.draggedIndex] = items[targetIndex];
    items[targetIndex] = temp;
    
    this.quickAccessItems = items;
    this.draggedIndex = null;
    
    this.renderModalContent();
  }
  
  async replaceItemInModal(index, newItemId) {
    if (index < 0 || index >= 6) return;
    
    this.quickAccessItems[index] = newItemId;
    this.renderModalContent();
  }
  
  async resetToDefaults() {
    const confirmed = await this.showAlert(
      'Reset to default quick access items for your role?',
      'Reset Quick Access'
    );
    
    if (confirmed) {
      this.useRoleDefaults();
      this.renderModalContent();
    }
  }
  
  render() {
    const container = document.querySelector('.frame-3');
    if (!container) return;
    
    const items = this.quickAccessItems.map((itemId, index) => {
      const option = this.availableOptions[itemId];
      if (!option) return '';
      
      const color = this.positionColors[index];
      
      return `
        <button 
          class="quick-access-btn ${color} py-3 rounded-lg shadow-custom font-semibold hover:shadow-lg transition-all select-none cursor-pointer"
          data-index="${index}"
          draggable="false"
          style="touch-action: none;">
          ${option.label}
        </button>
      `;
    }).join('');
    
    container.innerHTML = `
      <div class="flex items-center justify-center gap-3 mb-6">
        <h4 class="text-xl font-bold text-navy">Quick Access</h4>
        <button 
          onclick="window.quickAccessManager.openModal()" 
          class="text-navy hover:text-blue-600 transition-colors text-sm font-semibold"
          title="Edit">
          <i class="fa-solid fa-pen-to-square"></i>
        </button>
      </div>
      <div class="grid grid-cols-2 gap-6">
        ${items}
      </div>
    `;
    
    // Attach event listeners after render
    this.attachEventListeners();
  }
  
  attachEventListeners() {
    const buttons = document.querySelectorAll('.quick-access-btn');
    
    buttons.forEach((button, index) => {
      const option = this.availableOptions[this.quickAccessItems[index]];
      if (!option) return;
      
      // Remove any existing listeners by cloning
      const newButton = button.cloneNode(true);
      button.parentNode.replaceChild(newButton, button);
      
      // Long press for enabling drag
      newButton.addEventListener('mousedown', (e) => this.handleMouseDown(index, e));
      newButton.addEventListener('mouseup', (e) => this.handleMouseUp(e));
      newButton.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
      
      newButton.addEventListener('touchstart', (e) => this.handleMouseDown(index, e), { passive: true });
      newButton.addEventListener('touchend', (e) => this.handleMouseUp(e));
      newButton.addEventListener('touchcancel', (e) => this.handleMouseUp(e));
      
      // Standard drag events (work after long press enables draggable)
      newButton.addEventListener('dragstart', (e) => this.handleDashboardDragStart(index, e));
      newButton.addEventListener('dragover', (e) => this.handleDashboardDragOver(e));
      newButton.addEventListener('dragleave', (e) => this.handleDashboardDragLeave(e));
      newButton.addEventListener('drop', (e) => this.handleDashboardDrop(index, e));
      newButton.addEventListener('dragend', (e) => this.handleDashboardDragEnd(e));
      
      // Click for navigation
      newButton.addEventListener('click', (e) => this.handleButtonClick(option.section, option.title, e));
    });
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.quickAccessManager = new QuickAccessManager();
  console.log('✅ Quick Access Manager initialized');
});


function logout() {
  // Clear user session data
  sessionStorage.clear();
  localStorage.clear();

  // Redirect to login page
  window.location.href = 'personnel-login.html';
}

document.addEventListener('DOMContentLoaded', function() {
  // Make logout function globally accessible
  window.logout = logout;
});