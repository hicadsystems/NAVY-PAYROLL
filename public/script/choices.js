class CustomDropdown {
  constructor(element, options = {}) {
    if (!element) {
      throw new Error('CustomDropdown requires a valid element');
    }
    
    this.element = typeof element === 'string' ? document.querySelector(element) : element;
    
    if (!this.element) {
      throw new Error('Element not found');
    }
    
    // Store original element reference before replacing
    this.originalElement = this.element;
    
    // Store original value for restoration after data loads
    this.pendingValue = this.originalElement.value || null;
    
    // Extract placeholder from first option if it exists
    let extractedPlaceholder = options.placeholder || 'Select...';
    if (this.originalElement.options && this.originalElement.options.length > 0) {
      const firstOption = this.originalElement.options[0];
      if (!firstOption.value || firstOption.value === '') {
        extractedPlaceholder = firstOption.textContent.trim();
      }
    }
    
    this.config = {
      placeholder: extractedPlaceholder,
      searchEnabled: options.searchEnabled !== false,
      apiUrl: options.apiUrl || null,
      data: options.data || [],
      valueField: options.valueField || 'id',
      labelField: options.labelField || 'name',
      labelFormat: options.labelFormat || null,
      hiddenInputName: options.hiddenInputName || null,
      onSelect: options.onSelect || null,
      className: options.className || '',
      maxHeight: options.maxHeight || '240px',
      loadingText: options.loadingText || 'Loading...',
      errorText: options.errorText || 'Failed to load data',
      noResultsText: options.noResultsText || 'No results found',
      fetchHeaders: options.fetchHeaders || {},
      ...options
    };
    
    this.data = [];
    this.selectedValue = null;
    this.selectedText = null;
    this.isOpen = false;
    this.isLoading = false;
    this.validationMessage = '';
    this.dataLoadedCallbacks = [];
    this.isInitialized = false;
    
    this.init();
  }
  
  init() {
    this.createDropdownHTML();
    this.searchInput = this.element.querySelector('.custom-dropdown-search');
    this.dropdownList = this.element.querySelector('.custom-dropdown-list');
    this.dropdownItems = this.element.querySelector('.custom-dropdown-items');
    this.hiddenInput = this.element.querySelector('.custom-dropdown-hidden');
    this.arrow = this.element.querySelector('.custom-dropdown-arrow');
    this.bindEvents();
    
    this.isInitialized = true;
    
    if (this.config.apiUrl) {
      this.fetchData();
    } else if (this.config.data.length > 0) {
      this.setData(this.config.data);
    }
  }
  
  /**
   * Check if a value looks like placeholder text
   * @param {string} value - The value to check
   * @returns {boolean} - True if it's likely a placeholder
   */
  isPlaceholderText(value) {
    if (!value || typeof value !== 'string') return true;
    
    const trimmedValue = value.trim();
    
    // Empty string
    if (trimmedValue === '') return true;
    
    // Check if it matches the configured placeholder exactly
    if (this.config.placeholder && trimmedValue === this.config.placeholder) {
      return true;
    }
    
    // Only flag very obvious placeholder patterns
    const obviousPlaceholders = [
      /^select\s*\.\.\.$/i,      // "Select..."
      /^choose\s*\.\.\.$/i,      // "Choose..."
      /^--\s*select/i,           // "-- Select --"
      /^\.\.\.$/,                // "..."
      /^-+$/,                    // "---"
    ];
    
    const lowerValue = trimmedValue.toLowerCase();
    
    for (const pattern of obviousPlaceholders) {
      if (pattern.test(lowerValue)) {
        console.log('  🚫 Detected obvious placeholder:', value);
        return true;
      }
    }
    
    return false;
  }
  
  createDropdownHTML() {
    const wrapper = document.createElement('div');
    
    // Preserve the original element's ID and name
    const originalId = this.originalElement.id;
    const originalName = this.originalElement.name;
    const originalClasses = this.originalElement.className;
    
    // Filter out styling classes - keep only structural/grid classes
    const structuralClasses = originalClasses.split(' ').filter(cls => {
      return cls.match(/^(col-|row-|grid|flex|w-(?!full)|h-(?!full)|m-|mt-|mb-|ml-|mr-|mx-|my-)/);
    }).join(' ');
    
    wrapper.className = `custom-dropdown-wrapper relative ${structuralClasses} ${this.config.className}`.trim();
    if (originalId) wrapper.id = originalId;
    
    wrapper.innerHTML = `
      <div class="relative w-full">
        <input 
          type="text" 
          class="custom-dropdown-search w-full border border-blue-500 focus:border-yellow-500 bg-transparent rounded-md px-3 py-2 focus:outline-none pr-10"
          placeholder="${this.config.placeholder}"
          autocomplete="off"
          ${this.config.searchEnabled ? '' : 'readonly style="cursor: pointer;"'}>
        <span class="custom-dropdown-arrow absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none transition-transform duration-200">
          <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
          </svg>
        </span>
      </div>

      <div class="custom-dropdown-list fixed z-[999999] mt-1 bg-yellow-50 border border-gray-300 rounded-md shadow-lg overflow-y-auto hidden" style="max-height: ${this.config.maxHeight}">
        <div class="py-1 custom-dropdown-items"></div>
      </div>
      
      <input type="hidden" class="custom-dropdown-hidden" name="${originalName || this.config.hiddenInputName || ''}">
    `;
    
    this.element.parentNode.replaceChild(wrapper, this.element);
    this.element = wrapper;
    
    this.setupSelectCompatibility();
  }
  
  setupSelectCompatibility() {
    // Make element behave like a <select> element
    Object.defineProperty(this.element, 'value', {
      get: () => this.getValue(),
      set: (val) => {
        if (val === '' || val === null || val === undefined) {
          this.clear();
        } else {
          this.setValue(val);
        }
      },
      enumerable: true,
      configurable: true
    });
    
    // Add name property that returns the hidden input's name
    Object.defineProperty(this.element, 'name', {
      get: () => this.hiddenInput ? this.hiddenInput.name : '',
      set: (val) => {
        if (this.hiddenInput) {
          this.hiddenInput.name = val;
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'text', {
      get: () => this.getText(),
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'disabled', {
      get: () => this.searchInput ? this.searchInput.disabled : false,
      set: (val) => {
        if (this.searchInput) {
          this.searchInput.disabled = val;
          if (val) {
            this.element.classList.add('opacity-50', 'cursor-not-allowed');
            this.close();
          } else {
            this.element.classList.remove('opacity-50', 'cursor-not-allowed');
          }
        }
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'options', {
      get: () => {
        const options = this.data.map((item, index) => ({
          value: item[this.config.valueField],
          text: this.config.labelFormat 
            ? this.config.labelFormat(item) 
            : item[this.config.labelField],
          index: index,
          selected: item[this.config.valueField] == this.selectedValue
        }));
        
        options.selectedIndex = this.data.findIndex(
          item => item[this.config.valueField] == this.selectedValue
        );
        
        return options;
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'selectedIndex', {
      get: () => {
        return this.data.findIndex(
          item => item[this.config.valueField] == this.selectedValue
        );
      },
      set: (index) => {
        if (index >= 0 && index < this.data.length) {
          const item = this.data[index];
          const value = item[this.config.valueField];
          const text = this.config.labelFormat 
            ? this.config.labelFormat(item) 
            : item[this.config.labelField];
          this.selectItem(value, text, item);
        } else if (index === -1) {
          this.clear();
        }
      },
      enumerable: true,
      configurable: true
    });
    
    // Add setCustomValidity method
    this.element.setCustomValidity = (message) => {
      this.validationMessage = message || '';
      if (this.searchInput) {
        this.searchInput.setCustomValidity(message || '');
      }
      if (this.hiddenInput) {
        this.hiddenInput.setCustomValidity(message || '');
      }
    };
    
    // Add checkValidity method
    this.element.checkValidity = () => {
      return this.searchInput ? this.searchInput.checkValidity() : true;
    };
    
    // Add reportValidity method
    this.element.reportValidity = () => {
      return this.searchInput ? this.searchInput.reportValidity() : true;
    };
    
    // Add validationMessage property
    Object.defineProperty(this.element, 'validationMessage', {
      get: () => this.validationMessage,
      enumerable: true,
      configurable: true
    });
    
    // Add validity property
    Object.defineProperty(this.element, 'validity', {
      get: () => this.searchInput ? this.searchInput.validity : { valid: true },
      enumerable: true,
      configurable: true
    });
    
    this.element._customDropdown = this;
    
    const originalAddEventListener = this.element.addEventListener.bind(this.element);
    this.element.addEventListener = (type, listener, options) => {
      originalAddEventListener(type, listener, options);
    };
    
    this.element.appendChild = (option) => {
      if (option && option.tagName === 'OPTION') {
        const itemData = {
          [this.config.valueField]: option.value,
          [this.config.labelField]: option.textContent
        };
        this.data.push(itemData);
        this.renderItems(this.data);
      }
    };
    
    this.element.remove = (index) => {
      if (typeof index === 'number') {
        this.data.splice(index, 1);
        this.renderItems(this.data);
      } else {
        if (this.element.parentNode) {
          this.element.parentNode.removeChild(this.element);
        }
      }
    };
    
    Object.defineProperty(this.element, 'innerHTML', {
      set: (html) => {
        console.log('📝 [innerHTML setter] Called for:', this.element.id);
        
        // Store current value to restore after data loads
        const currentValue = this.selectedValue || this.pendingValue;
        console.log('  💾 Current value to restore:', currentValue);
        
        this.data = [];
        this.selectedValue = null;
        this.selectedText = null;
        
        if (html && html.includes('<option')) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = html;
          const options = tempDiv.querySelectorAll('option');
          
          console.log('  📊 Found', options.length, 'options');
          
          let detectedPlaceholder = null;
          
          options.forEach(option => {
            const value = (option.value || '').trim();
            const text = (option.textContent || '').trim();
            
            // Check if this is a placeholder option (empty value)
            if (!value || value === '') {
              // Update placeholder
              if (text && this.searchInput) {
                this.searchInput.placeholder = text;
                this.config.placeholder = text;
                detectedPlaceholder = text;
              }
            } else {
              // Only add options with actual values
              const itemData = {
                [this.config.valueField]: value,
                [this.config.labelField]: text
              };
              this.data.push(itemData);
            }
          });
          
          console.log('  ✅ Loaded', this.data.length, 'items');
          console.log('  📋 Detected placeholder:', detectedPlaceholder);
          
          // Clear the visible input
          if (this.searchInput) {
            this.searchInput.value = '';
          }
          if (this.hiddenInput) {
            this.hiddenInput.value = '';
          }
          
          // Render items
          this.renderItems(this.data);
          
          // Restore value if we have one AND data is loaded
          if (currentValue && this.data.length > 0) {
            console.log('  🔄 Attempting to restore value:', currentValue);
            queueMicrotask(() => {
              const success = this._setValueInternal(currentValue, false);
              if (success) {
                console.log('  ✅ Value restored successfully');
              } else {
                console.log('  ⚠️ Value not found in data, storing as pending');
                this.pendingValue = currentValue;
              }
            });
          } else if (currentValue) {
            console.log('  ⏳ Data not ready, storing as pending:', currentValue);
            this.pendingValue = currentValue;
          }
          
          // Trigger data loaded callbacks
          this.triggerDataLoaded();
        }
      },
      get: () => {
        // Include placeholder as first option
        let html = `<option value="">${this.config.placeholder}</option>`;
        html += this.data.map(item => 
          `<option value="${item[this.config.valueField]}">${item[this.config.labelField]}</option>`
        ).join('');
        return html;
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'length', {
      get: () => this.data.length,
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(this.element, 'type', {
      get: () => 'select-one',
      enumerable: true,
      configurable: true
    });
    
    // Override getAttribute to support name queries
    const originalGetAttribute = this.element.getAttribute.bind(this.element);
    this.element.getAttribute = (attr) => {
      if (attr === 'name') {
        return this.hiddenInput ? this.hiddenInput.name : originalGetAttribute(attr);
      }
      return originalGetAttribute(attr);
    };
    
    // Override setAttribute to support name setting
    const originalSetAttribute = this.element.setAttribute.bind(this.element);
    this.element.setAttribute = (attr, value) => {
      if (attr === 'name' && this.hiddenInput) {
        this.hiddenInput.name = value;
      }
      return originalSetAttribute(attr, value);
    };
  }
  
  bindEvents() {
    // Click to toggle for non-searchable
    if (!this.config.searchEnabled) {
      this.searchInput.addEventListener('click', () => {
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
      });
    }
    
    this.searchInput.addEventListener('focus', () => {
      if (!this.isOpen) {
        this.open();
      }
    });
    
    if (this.config.searchEnabled) {
      this.searchInput.addEventListener('input', (e) => {
        this.filterItems(e.target.value);
        if (!this.isOpen) {
          this.open();
        }
      });
    }
    
    // Arrow click handler
    if (this.arrow) {
      this.arrow.style.pointerEvents = 'auto';
      this.arrow.style.cursor = 'pointer';
      this.arrow.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (this.isOpen) {
          this.close();
        } else {
          this.open();
        }
        this.searchInput.focus();
      });
    }
    
    document.addEventListener('click', (e) => {
      if (!this.element.contains(e.target) && !this.dropdownList.contains(e.target)) {
        this.close();
      }
    });
    
    this.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
        this.searchInput.blur();
      }
    });
    
    // Reposition on scroll/resize
    const reposition = () => {
      if (this.isOpen) {
        this.positionDropdown();
      }
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    
    this.element._originalAddEventListener = this.element.addEventListener;
  }
  
  async fetchData() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.showLoading();
    
    try {
      const token = window.storageAvailable ? localStorage.getItem('token') : null;
      const headers = {
        'Authorization': token ? `Bearer ${token}` : '',
        ...this.config.fetchHeaders
      };
      
      const response = await fetch(this.config.apiUrl, {
        method: 'GET',
        headers: headers
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.setData(result.data);
      } else {
        this.showError();
      }
    } catch (error) {
      console.error('CustomDropdown fetch error:', error);
      this.showError();
    } finally {
      this.isLoading = false;
    }
  }
  
  setData(data) {
    console.log('📊 [setData] Called with', data.length, 'items for:', this.element.id);
    
    this.data = data;
    this.renderItems(data);
    
    // Restore pending value after data loads
    if (this.pendingValue && this.data.length > 0) {
      console.log('  🔄 Restoring pending value:', this.pendingValue);
      queueMicrotask(() => {
        const success = this._setValueInternal(this.pendingValue, false);
        if (success) {
          console.log('  ✅ Pending value restored successfully');
          this.pendingValue = null;
        } else {
          console.log('  ⚠️ Pending value not found in data');
        }
      });
    }
    
    // Trigger data loaded callbacks
    this.triggerDataLoaded();
  }
  
  // Method to register callback for when data is loaded
  onDataLoaded(callback) {
    if (this.data.length > 0) {
      // Data already loaded, call immediately
      callback();
    } else {
      // Store for later
      this.dataLoadedCallbacks.push(callback);
    }
  }
  
  // Trigger all registered data loaded callbacks
  triggerDataLoaded() {
    console.log('📢 [triggerDataLoaded] Firing', this.dataLoadedCallbacks.length, 'callbacks');
    while (this.dataLoadedCallbacks.length > 0) {
      const callback = this.dataLoadedCallbacks.shift();
      try {
        callback();
      } catch (error) {
        console.error('Error in data loaded callback:', error);
      }
    }
  }
  
  renderItems(items) {
    if (items.length === 0) {
      this.dropdownItems.innerHTML = `
        <div class="px-3 py-4 text-center text-gray-500">
          ${this.config.noResultsText}
        </div>
      `;
      return;
    }
    
    // PERFORMANCE: Use innerHTML string concatenation - much faster than DOM manipulation
    let html = '';
    
    items.forEach(item => {
      const value = item[this.config.valueField];
      const label = this.config.labelFormat 
        ? this.config.labelFormat(item) 
        : item[this.config.labelField];
      
      // Escape HTML to prevent XSS
      const escapedLabel = String(label).replace(/[&<>"']/g, (char) => {
        const escapeMap = {
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        };
        return escapeMap[char];
      });
      
      const isSelected = this.selectedValue == value ? ' bg-blue-100' : '';
      html += `<div class="custom-dropdown-item px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-100 transition-colors${isSelected}" data-value="${value}">${escapedLabel}</div>`;
    });
    
    this.dropdownItems.innerHTML = html;
    
    // PERFORMANCE: Use event delegation instead of individual listeners
    this.dropdownItems.onclick = (e) => {
      const itemEl = e.target.closest('.custom-dropdown-item');
      if (!itemEl) return;
      
      const value = itemEl.getAttribute('data-value');
      const item = items.find(i => i[this.config.valueField] == value);
      
      if (item) {
        const label = this.config.labelFormat 
          ? this.config.labelFormat(item) 
          : item[this.config.labelField];
        this.selectItem(value, label, item);
      }
    };
  }
  
  selectItem(value, text, fullData) {
    console.log('✅ [selectItem] Selecting:', value, text);
    
    this.selectedValue = value;
    this.selectedText = text;
    this.searchInput.value = text;
    
    if (this.hiddenInput) {
      this.hiddenInput.value = value;
    }
    
    this.close();
    
    // Re-render to show selected state
    this.renderItems(this.data);
    
    if (this.config.onSelect) {
      this.config.onSelect(value, text, fullData);
    }
    
    // Dispatch change event (most compatible with native select)
    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
    this.element.dispatchEvent(changeEvent);
    
    // Dispatch input event
    const inputEvent = new Event('input', { bubbles: true, cancelable: true });
    this.element.dispatchEvent(inputEvent);
    
    // Dispatch custom event with data
    const customEvent = new CustomEvent('dropdown:change', {
      detail: { value, text, data: fullData },
      bubbles: true,
      cancelable: true
    });
    this.element.dispatchEvent(customEvent);
  }
  
  filterItems(searchText) {
    const filtered = this.data.filter(item => {
      const label = this.config.labelFormat 
        ? this.config.labelFormat(item) 
        : item[this.config.labelField];
      
      return label.toLowerCase().includes(searchText.toLowerCase());
    });
    
    this.renderItems(filtered);
    
    if (!this.isOpen) {
      this.open();
    }
  }
  
  positionDropdown() {
    const inputRect = this.searchInput.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - inputRect.bottom;
    const spaceAbove = inputRect.top;
    const dropdownHeight = parseInt(this.config.maxHeight);
    
    // Set width to match input
    this.dropdownList.style.width = inputRect.width + 'px';
    
    // Smart positioning
    if (spaceBelow < dropdownHeight && spaceAbove > spaceBelow) {
      // Open upward
      this.dropdownList.style.bottom = (viewportHeight - inputRect.top + 4) + 'px';
      this.dropdownList.style.top = 'auto';
      this.dropdownList.style.left = inputRect.left + 'px';
    } else {
      // Open downward
      this.dropdownList.style.top = (inputRect.bottom + 4) + 'px';
      this.dropdownList.style.bottom = 'auto';
      this.dropdownList.style.left = inputRect.left + 'px';
    }
  }
  
  open() {
    if (this.data.length === 0 && this.config.apiUrl) {
      this.fetchData();
    }
    
    this.dropdownList.classList.remove('hidden');
    this.positionDropdown();
    
    // SVG arrow flip using scaleY
    if (this.arrow) {
      this.arrow.style.transform = 'scaleY(-1)';
    }
    
    this.isOpen = true;
  }
  
  close() {
    this.dropdownList.classList.add('hidden');
    
    // Flip arrow back
    if (this.arrow) {
      this.arrow.style.transform = 'scaleY(1)';
    }
    
    this.isOpen = false;
  }
  
  showLoading() {
    this.dropdownItems.innerHTML = `
      <div class="px-3 py-4 text-center text-gray-500">
        <svg class="animate-spin h-5 w-5 mx-auto mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        ${this.config.loadingText}
      </div>
    `;
  }
  
  showError() {
    this.dropdownItems.innerHTML = `
      <div class="px-3 py-4 text-center text-red-500">
        ${this.config.errorText}
      </div>
    `;
  }
  
  getValue() {
    return this.selectedValue;
  }
  
  getText() {
    return this.selectedText;
  }
  
  /**
   * Internal setValue that returns success/failure
   * @param {*} value - The value to set (can be value field OR text field)
   * @param {boolean} fireEvents - Whether to fire change events (default: true)
   * @returns {boolean} - True if value was found and set, false otherwise
   */
  _setValueInternal(value, fireEvents = true) {
    console.log('🔧 [_setValueInternal] Setting value:', value, 'Fire events:', fireEvents);
    
    // Simple validation
    if (value === null || value === undefined || value === '') {
      console.log('  🚫 Empty value, ignoring');
      return false;
    }
    
    // If data not loaded yet, store as pending
    if (this.data.length === 0) {
      console.log('  ⏳ Data not loaded, storing as pending');
      this.pendingValue = value;
      return false;
    }
    
    let item = null;
    
    // FIRST: Try to find by LABEL/TEXT field (most common case from API)
    item = this.data.find(i => i[this.config.labelField] == value);
    if (item) {
      console.log('  ✅ Found by label field');
    }
    
    // FALLBACK: Try to find by VALUE field
    if (!item) {
      item = this.data.find(i => i[this.config.valueField] == value);
      if (item) {
        console.log('  ✅ Found by value field');
      }
    }
    
    if (item) {
      const actualValue = item[this.config.valueField];
      const text = this.config.labelFormat 
        ? this.config.labelFormat(item) 
        : item[this.config.labelField];
      
      // Set the values
      this.selectedValue = actualValue;
      this.selectedText = text;
      this.searchInput.value = text;
      
      if (this.hiddenInput) {
        this.hiddenInput.value = actualValue;
      }
      
      // Re-render to show selected state
      this.renderItems(this.data);
      
      // Fire events if requested
      if (fireEvents) {
        if (this.config.onSelect) {
          this.config.onSelect(actualValue, text, item);
        }
        
        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
        this.element.dispatchEvent(changeEvent);
        
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        this.element.dispatchEvent(inputEvent);
        
        const customEvent = new CustomEvent('dropdown:change', {
          detail: { value: actualValue, text, data: item },
          bubbles: true,
          cancelable: true
        });
        this.element.dispatchEvent(customEvent);
      }
      
      return true;
    }
    
    console.log('  ❌ Not found');
    return false;
  }
  
  setValue(value, fireEvents = true) {
    console.log('📝 [setValue] Called with:', value);
    
    const success = this._setValueInternal(value, fireEvents);
    
    if (!success) {
      // Value not found, store as pending for when data loads
      this.pendingValue = value;
      console.log('  💾 Stored as pending value');
    }
  }
  
  clear() {
    console.log('🧹 [clear] Clearing selection');
    
    this.selectedValue = null;
    this.selectedText = null;
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    if (this.hiddenInput) {
      this.hiddenInput.value = '';
    }
    
    // Fast re-render
    if (this.data.length > 0) {
      this.renderItems(this.data);
    }
    
    // Dispatch change event
    this.element.dispatchEvent(new Event('change', { bubbles: true }));
    this.element.dispatchEvent(new Event('input', { bubbles: true }));
    this.element.dispatchEvent(new CustomEvent('dropdown:change', {
      detail: { value: null, text: '', data: null },
      bubbles: true
    }));
  }
  
  refresh() {
    if (this.config.apiUrl) {
      this.data = [];
      this.fetchData();
    }
  }
  
  destroy() {
    this.element.remove();
  }
}

window.storageAvailable = (() => {
  try {
    const test = '__storage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch (e) {
    return false;
  }
})();

// ============================================
// OPTIMIZED AUTO-INITIALIZATION
// ============================================

(function() {
  const originalGetElementById = Document.prototype.getElementById;
  const originalQuerySelector = Document.prototype.querySelector;
  const originalQuerySelectorAll = Document.prototype.querySelectorAll;
  
  const convertedSelects = new WeakMap();
  const selectIdMap = new Map();
  
  function getDropdownConfig() {
    console.log('🔍 [getDropdownConfig] Checking for configs...');
    console.log('  window.dropdownConfig exists?', !!window.dropdownConfig);
    console.log('  window.customDropdownConfig exists?', !!window.customDropdownConfig);
    
    // IMPORTANT: Check EVERY TIME, don't cache, because dropdownConfig might be created after script loads
    if (window.dropdownConfig) {
      console.log('✅ [getDropdownConfig] Using structured dropdownConfig:', Object.keys(window.dropdownConfig));
      return {
        searchEnabled: true,
        configs: window.dropdownConfig,
        type: 'structured'
      };
    }
    
    const simpleConfig = window.customDropdownConfig || {
      searchEnabled: true,
      searchable: [],
      type: 'simple'
    };
    console.log('⚠️ [getDropdownConfig] Using simple config:', simpleConfig);
    return simpleConfig;
  }
  
  function getSearchableConfig(selectElement, config) {
    console.log('🔎 [getSearchableConfig] Checking searchable for:', selectElement.id);
    
    // Check data attribute first (highest priority)
    if (selectElement.hasAttribute('data-searchable')) {
      const result = selectElement.getAttribute('data-searchable') !== 'false';
      console.log('  ✓ data-searchable attribute found:', result);
      return result;
    }
    
    // Check if using structured config with specific field mappings
    if (config.type === 'structured' && config.configs && selectElement.id) {
      console.log('  📋 Checking structured config...');
      // For structured config, search through all field names to find matching ID
      for (const [fieldName, fieldConfig] of Object.entries(config.configs)) {
        const expectedId = `field-${fieldName.replace(/\s+/g, '-').toLowerCase()}`;
        console.log(`    Comparing "${selectElement.id}" with "${expectedId}"`);
        if (selectElement.id === expectedId) {
          console.log('    ✅ Match found! Field:', fieldName, 'Config:', fieldConfig);
          // Found matching field, default to searchable for structured configs
          return true;
        }
      }
      console.log('  ⚠️ No match in structured config, checking if it\'s a non-Step1 field');
      // For non-Step1 fields (like entry_mode, exittype, etc.), check if they should be searchable
      // Default to true for all selects when using structured config
      return true;
    }
    
    // Check searchable array from simple config
    if (config.searchable && Array.isArray(config.searchable)) {
      console.log('  📋 Checking searchable array:', config.searchable);
      if (selectElement.id && config.searchable.includes(selectElement.id)) {
        console.log('    ✅ Found in searchable array');
        return true;
      } else if (selectElement.id && config.searchable.length > 0) {
        console.log('    ❌ Not in searchable array, returning false');
        return false;
      }
    }
    
    // Default behavior - searchable by default
    const defaultResult = config.searchEnabled !== false;
    console.log('  🔄 Using default searchEnabled:', defaultResult);
    return defaultResult;
  }
  
  function convertSelectToDropdown(selectElement) {
    console.log('🔄 [convertSelectToDropdown] START for:', selectElement.id || selectElement.name || 'unnamed');
    
    if (convertedSelects.has(selectElement)) {
      console.log('  ⏭️ Already converted, returning cached');
      return convertedSelects.get(selectElement);
    }
    
    if (!selectElement || selectElement.tagName !== 'SELECT') {
      console.log('  ❌ Not a select element, skipping');
      return selectElement;
    }
    
    const existingOptions = Array.from(selectElement.options).map(opt => ({
      value: (opt.value || '').trim(),
      name: (opt.textContent || '').trim()
    }));
    console.log('  📊 Extracted', existingOptions.length, 'options');
    
    let placeholder = 'Select...';
    const firstOption = selectElement.options[0];
    if (firstOption && (!firstOption.value || firstOption.value === '')) {
      placeholder = (firstOption.textContent || '').trim() || 'Select...';
    }
    console.log('  📝 Placeholder:', placeholder);
    
    // Get config FRESH every time (don't cache)
    const config = getDropdownConfig();
    const searchEnabled = getSearchableConfig(selectElement, config);
    console.log('  🔍 Final searchEnabled:', searchEnabled);
    
    const dropdown = new CustomDropdown(selectElement, {
      placeholder: placeholder,
      searchEnabled: searchEnabled,
      data: existingOptions,
      valueField: 'value',
      labelField: 'name'
    });
    
    convertedSelects.set(selectElement, dropdown.element);
    
    if (selectElement.id) {
      selectIdMap.set(selectElement.id, dropdown.element);
      console.log('  💾 Stored in ID map:', selectElement.id);
    }
    
    console.log('✅ [convertSelectToDropdown] COMPLETE for:', selectElement.id);
    return dropdown.element;
  }
  
  function convertAll() {
    console.log('🚀 [convertAll] START - Searching for unconverted selects...');
    const selects = document.querySelectorAll('select:not([data-dropdown-converted])');
    console.log(`  📋 Found ${selects.length} select(s) to convert`);
    
    if (selects.length > 0) {
      const batchSize = 20;
      let index = 0;
      
      function convertBatch() {
        const end = Math.min(index + batchSize, selects.length);
        console.log(`  🔄 Converting batch ${index}-${end} of ${selects.length}`);
        
        for (let i = index; i < end; i++) {
          selects[i].setAttribute('data-dropdown-converted', 'true');
          convertSelectToDropdown(selects[i]);
        }
        
        index = end;
        
        if (index < selects.length) {
          requestAnimationFrame(convertBatch);
        } else {
          console.log('✅ [convertAll] COMPLETE - All selects converted');
        }
      }
      
      convertBatch();
    } else {
      console.log('  ℹ️ No selects to convert');
    }
  }
  
  Document.prototype.getElementById = function(id) {
    if (selectIdMap.has(id)) {
      return selectIdMap.get(id);
    }
    
    const element = originalGetElementById.call(this, id);
    if (element?.tagName === 'SELECT') {
      const converted = convertSelectToDropdown(element);
      if (id) {
        selectIdMap.set(id, converted);
      }
      return converted;
    }
    return element;
  };
  
  Document.prototype.querySelector = function(selector) {
    const element = originalQuerySelector.call(this, selector);
    if (element?.tagName === 'SELECT') {
      return convertSelectToDropdown(element);
    }
    return element;
  };
  
  Document.prototype.querySelectorAll = function(selector) {
    const elements = originalQuerySelectorAll.call(this, selector);
    if (selector.toLowerCase().includes('select')) {
      return Array.from(elements).map(el => 
        el.tagName === 'SELECT' ? convertSelectToDropdown(el) : el
      );
    }
    return elements;
  };
  
  let mutationTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(convertAll, 50);
  });
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      convertAll();
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true });
      }
    });
  } else {
    convertAll();
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  
  window.convertSelectToDropdown = convertSelectToDropdown;
  window.convertAllSelects = convertAll;
})();