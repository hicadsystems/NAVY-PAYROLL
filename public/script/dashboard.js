
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
function setupSubmenuNavigation() {
  // Define the navigation mapping for each submenu item
  const navigationMap = {
    // Administration submenu
    'Create User': '#create-user',
    'Control User': '#control-user',
    'Close/Open Payroll Period': '#payroll-period',
    'Payroll Class Setup': '#payroll-class-setup',
    'Change Payroll Class': '#change-payroll-class',
    'Change Registration Number': '#change-registration',
    'Company Profile': '#company-profile',
    'Monthly and Yearly Processing': '#monthly-yearly-processing',

    // Personnel Profile submenu
    'Add New Personnel': '#add-personnel',
    'Current Personnel': '#current-personnel',
    'Old Personnel': '#old-personnel',

    // Data Input submenu
    'Payments/Deductions': '#payments-deductions',
    'Variation to Payments/Deductions': '#variation-payments',
    'Cumulative Payroll Transfer': '#cumulative-transfer',
    'Input Documentation': '#input-documentation',
    'Arrears Calculations': '#arrears-calculations',

    // File Update submenu
    'Save Payroll Files': '#save-payroll-files',
    'Input Variable Report': '#input-variable-report',
    'Changes in Personnel Data': '#personnel-data-changes',
    'Master File Update': '#master-file-update',
    'Recall Payment Files': '#recall-payment-files',

    // Payroll Calculations submenu
    'Back Up': '#backup',
    'Restore': '#restore',
    'Payroll Calculations': '#payroll-calculations',

    // Reference Tables submenu
    'Overtime Information': '#overtime-info',
    'Factory/Branch': '#factory-branch',
    'Cash Payment': '#cash-payment',
    'Tax Table Information': '#tax-table-info',
    'Salary Scale Information': '#salary-scale-info',
    'Pay Element Description': '#pay-element-description',
    'Bank Details': '#bank-details',
    'Department': '#department',
    'State Codes': '#state-codes',
    'Local Government': '#local-government',

    // Utilities submenu
    'Irregular One-Off Payments': '#irregular-payments',
    'Inter Payroll Class Transfer': '#inter-payroll-transfer',

    // Reports submenu
    'Pay Slips': '#pay-slips',
    'Payments by Bank(Branch)': '#payments-by-bank',
    'Analysis of Earnings/Deductions': '#earnings-analysis',
    'Loan Analysis': '#loan-analysis',
    'Analisis of Payments/Deductions by Bank': '#payments-analysis-bank',
    'Tax Payments By State': '#tax-payments-state',
    'Overtime Analysis by Dept': '#overtime-analysis-dept',
    'Payroll Register': '#payroll-register',
    'Listing of Payroll Files': '#listing-payroll-files',
    'Payment Staff List': '#payment-staff-list',
    'National Housing Funds': '#national-housing-funds',
    'NSITF': '#nsitf',
    'Salary Summary': '#salary-summary',
    'Analysis of Normal Hours by Dept.': '#normal-hours-analysis',
    'Salary Reconcilation': '#salary-reconciliation',

    // Audit Trail submenu
    'Salary Variance Analysis': '#salary-variance-analysis',
    'Changes in Personal Details Record': '#personal-details-changes',
    'Variation Input Listings': '#variation-input-listings',
    'Overpayment': '#overpayment',
    'Duplicate Account Number': '#duplicate-account'
  };

  // Add click handlers to all submenu links
  document.querySelectorAll('.submenu ul li a').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      
      const linkText = this.textContent.trim();
      const targetSection = navigationMap[linkText];
      
      if (targetSection) {
        // Close all submenus first
        closeAll();
        
        // Navigate to the section
        navigateToSection(targetSection, linkText);
      } else {
        console.log(`Navigation not defined for: ${linkText}`);
      }
    });
  });
}

// Function to handle navigation to different sections
function navigateToSection(sectionId, sectionName) {
  // Option 1: Scroll to section if it exists on the page
  const targetElement = document.querySelector(sectionId);
  if (targetElement) {
    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  // Option 2: Navigate to different pages/routes
  // Uncomment and modify based on your routing system
  
  // For single-page application:
  // window.history.pushState({}, '', sectionId);
  // loadContent(sectionId);
  
  // For multi-page navigation:
  // window.location.href = `page.html${sectionId}`;
  
  // For now, show a placeholder
  showSectionContent(sectionName, sectionId);

document.querySelectorAll('.submenu ul li a').forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();

  // Hide menu if screen is <= 1023px
  if (window.innerWidth <= 1023) {
    const linkText = this.textContent.trim();
    const targetSection = navigationMap[linkText];
    const sidebar = document.querySelector('#sidebar');

      if (targetSection && sidebar) {
        // Close all submenus first
        closeAll();
        sidebar.style.display = 'none';
      }
    }
    });
  });
}


// Placeholder function to show section content

function showSectionContent(sectionName, sectionId) {
  const mainContent = document.querySelector('main');
  if (mainContent) {
    // Replace everything with the section itself (mobile-friendly)
    mainContent.innerHTML = `
      <div class="mt-6">
        <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
        <div class="bg-white/20 rounded-xl p-6 shadow-lg">
          <div class="mt-4 p-4 bg-amber-50 rounded-lg">
            <p class="text-sm">This is a placeholder for the <strong>${sectionName}</strong> functionality.</p>
            <p class="text-sm mt-2">Replace this with your actual content/component for this section.</p>
          </div>
        </div>
      </div>
    `;
  }

  // Update page title
  document.title = `HICAD — ${sectionName}`;

  // Push into history
  window.history.pushState({ section: sectionName }, '', sectionId);
}

// Handle browser back/forward buttons
window.addEventListener('popstate', function(event) {
  if (event.state && event.state.section) {
    const sectionName = event.state.section;
    const sectionId = window.location.hash || window.location.pathname;
    showSectionContent(sectionName, sectionId);
  }
});

// Initialize the navigation system
document.addEventListener('DOMContentLoaded', function() {
  setupSubmenuNavigation();
});

// Add this to your existing submenu script after the closeAll function
setupSubmenuNavigation();