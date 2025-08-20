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
}

// Placeholder function to show section content
function showSectionContent(sectionName, sectionId) {
  // Update main content area
  const mainContent = document.querySelector('main');
  if (mainContent) {
    // Create a simple content placeholder
    const contentHTML = `
      <div class="mt-6">
        <h2 class="text-2xl lg:text-3xl font-bold text-navy mb-4">${sectionName}</h2>
        <div class="bg-white/20 rounded-xl p-6 shadow-lg">
          <p class="text-gray-700 mb-4">You have navigated to: <strong>${sectionName}</strong></p>
          <p class="text-sm text-gray-600">Section ID: ${sectionId}</p>
          <div class="mt-4 p-4 bg-amber-50 rounded-lg">
            <p class="text-sm">This is a placeholder for the <strong>${sectionName}</strong> functionality.</p>
            <p class="text-sm mt-2">Replace this with your actual content/component for this section.</p>
          </div>
        </div>
      </div>
    `;
    
    // Replace the main content
    const existingContent = mainContent.querySelector('.mt-6');
    if (existingContent) {
      existingContent.innerHTML = contentHTML;
    }
  }
  
  // Update page title
  document.title = `HICAD — ${sectionName}`;
  
  // Add to browser history
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