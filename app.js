/**
 * Subscript - Core Application Logic
 */

class SubscriptApp {
  // Escape HTML characters to prevent XSS
  escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Returns today's date as YYYY-MM-DD string
  todayStr() {
    return new Date().toISOString().split('T')[0];
  }

  // Returns a date N days from today as YYYY-MM-DD
  daysFromToday(n) {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  constructor() {
    this.currentTab = 'list';
    this.currentScope = 'personal'; // 'personal' or 'team'

    // Load persisted user name (set during onboarding)
    this.userName = localStorage.getItem('subscript_user_name') || 'You';

    // Calendar state — default to current month
    const now = new Date();
    this.calendarYear = now.getFullYear();
    this.calendarMonth = now.getMonth(); // 0-indexed
    
    // Core state
    this.dismissedRedundancies = JSON.parse(localStorage.getItem('subscript_dismissed_redundancies')) || [];

    // New users start empty — subscriptions are added during or after onboarding
    this.subscriptions = JSON.parse(localStorage.getItem('subscript_subscriptions')) || [];

    // Load or initialize Virtual Cards
    const defaultCards = [
      { id: 'c1', name: 'Personal Card', digits: '•••• •••• •••• 8899', expiry: '09/29', limit: 50.00, scope: 'personal' },
      { id: 'c2', name: 'Team SaaS Card', digits: '•••• •••• •••• 4321', expiry: '12/28', limit: 150.00, scope: 'team' }
    ];
    this.virtualCards = JSON.parse(localStorage.getItem('subscript_virtual_cards')) || defaultCards;
    this.selectedCardId = this.virtualCards[0].id;

    // Standardize saved subscriptions with default card bindings & seat ratios
    this.subscriptions.forEach(sub => {
      if (!sub.cardId) {
        sub.cardId = sub.isTeam ? 'c2' : 'c1';
      }
      if (sub.isTeam) {
        if (sub.seatsPurchased === undefined) {
          if (sub.name === 'Slack Pro') {
            sub.seatsPurchased = 3; sub.seatsAssigned = 2; sub.pricePerSeat = 8.75;
          } else if (sub.name === 'ChatGPT Plus') {
            sub.seatsPurchased = 2; sub.seatsAssigned = 1; sub.pricePerSeat = 10.00;
          } else {
            sub.seatsPurchased = 1; sub.seatsAssigned = 1; sub.pricePerSeat = parseFloat(sub.price);
          }
        }
      }
    });

    // Owner-only teammate list; teammates can be added from Settings/Team
    const ownerName = this.userName !== 'You' ? `${this.userName} (You)` : 'You';
    const ownerEmail = localStorage.getItem('subscript_user_email') || '';
    this.teammates = JSON.parse(localStorage.getItem('subscript_teammates')) || [
      { id: 't1', name: ownerName, email: ownerEmail, role: 'Owner', status: 'active' }
    ];

    // No pre-seeded notifications — generated dynamically from real subscription data
    this.notifications = JSON.parse(localStorage.getItem('subscript_notifications')) || [];

    this.gmailScannable = [
      { name: 'Adobe Creative Cloud', price: 54.99, cycle: 'monthly', category: 'Productivity' },
      { name: 'AWS Cloud Services', price: 12.50, cycle: 'monthly', category: 'Utilities' },
      { name: 'Google One 100GB', price: 1.99, cycle: 'monthly', category: 'Utilities' },
      { name: 'Zoom Pro', price: 14.99, cycle: 'monthly', category: 'SaaS & Dev Tools' }
    ];

    // Load or initialize Connected Emails list (populated during onboarding)
    this.connectedEmails = JSON.parse(localStorage.getItem('subscript_connected_emails')) || [];

    // Load Widescreen Layout state
    this.layoutMode = localStorage.getItem('subscript_layout_mode') || 'desktop';

    this.selectedDetectedSubs = [];
    this.activeCancelSub = null;
    this.cancelTimer = null;
    this.activeTimeouts = [];
    
    // Check if onboarding is completed
    this.onboardingCompleted = localStorage.getItem('subscript_onboarding_completed') === 'true';
    this.onboardingBranch = null;
    this.onboardingStep = 1;
    this.selectedOnboardingPresets = [];
    
    // UI Helpers
    this.initTime();
    this.applyLayoutMode();
    this.renderAll();

    if (!this.onboardingCompleted) {
      this.startOnboarding();
    } else {
      // Check and fire real browser notifications once per day
      setTimeout(() => this.checkAndFireNotifications(), 1500);
    }
  }

  // Update Status Bar Time
  initTime() {
    const updateTime = () => {
      const date = new Date();
      let hours = date.getHours();
      let minutes = date.getMinutes();
      hours = hours < 10 ? '0' + hours : hours;
      minutes = minutes < 10 ? '0' + minutes : minutes;
      const element = document.getElementById('status-time');
      if (element) {
        element.innerText = `${hours}:${minutes}`;
      }
    };
    updateTime();
    setInterval(updateTime, 60000);
  }

  // CORE RENDER METHOD
  renderAll() {
    this.updateMetrics();
    this.renderAlertsSection();
    this.renderSubscriptionsList();
    this.renderCalendarHeatmap();
    this.renderUpcomingOutflows();
    this.renderAnalytics();
    this.updateTeammatesUI();
    this.renderTeamBar();
    this.updateNotificationDot();
    this.renderSpendTrendChart();
    this.renderSeatUsageAnalyzer();
    this.renderWallet();
    this.updateCardDropdown();
  }

  saveState() {
    localStorage.setItem('subscript_subscriptions', JSON.stringify(this.subscriptions));
    localStorage.setItem('subscript_notifications', JSON.stringify(this.notifications));
    localStorage.setItem('subscript_dismissed_redundancies', JSON.stringify(this.dismissedRedundancies));
    localStorage.setItem('subscript_virtual_cards', JSON.stringify(this.virtualCards));
    localStorage.setItem('subscript_connected_emails', JSON.stringify(this.connectedEmails));
    localStorage.setItem('subscript_teammates', JSON.stringify(this.teammates));
  }

  // Financial Metrics: Monthly Burn & Annualized Projection
  updateMetrics() {
    // Filter active (not cancelled) subscriptions matching current scope
    const activeSubs = this.subscriptions.filter(sub => {
      const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
      return matchesScope && !sub.isCancelled;
    });

    let totalMonthly = 0;
    activeSubs.forEach(sub => {
      const price = parseFloat(sub.price);
      if (sub.cycle === 'monthly') {
        totalMonthly += price;
      } else {
        totalMonthly += (price / 12);
      }
    });

    const totalAnnual = totalMonthly * 12;

    document.getElementById('total-monthly-burn').innerText = `$${totalMonthly.toFixed(2)}`;
    document.getElementById('total-annual-burn').innerText = `$${totalAnnual.toFixed(2)}`;
  }

  // Renders the alerts section on dashboard
  renderAlertsSection() {
    const container = document.getElementById('alerts-section');
    if (!container) return;
    container.innerHTML = '';

    // 1. Redundancy Alerts
    const duplicates = this.detectRedundancies();
    duplicates.forEach(dup => {
      const card = document.createElement('div');
      card.className = 'alert-card alert-redundancy';
      card.innerHTML = `
        <span class="alert-icon">⚠️</span>
        <div class="alert-content">
          <div class="alert-title">Redundant Services Detected</div>
          <div class="alert-desc">You are paying for both <strong>${this.escapeHtml(dup.sub1.name)}</strong> and <strong>${this.escapeHtml(dup.sub2.name)}</strong> (${this.escapeHtml(dup.sub1.category)}). Do you need both?</div>
          <button class="alert-action-btn" onclick="app.openRedundancyReview(${dup.sub1.id}, ${dup.sub2.id})">Review Analytics</button>
        </div>
        <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
      `;
      container.appendChild(card);
    });

    // 2. Price Hikes (only for active subs in current scope)
    const activeSubs = this.subscriptions.filter(s => !s.isCancelled && (this.currentScope === 'team' ? s.isTeam : !s.isTeam));
    activeSubs.forEach(sub => {
      if (sub.priceHike) {
        const diff = sub.priceHike.newPrice - sub.priceHike.originalPrice;
        const diffText = diff > 0 ? `increased by $${diff.toFixed(2)}/mo` : `decreased by $${Math.abs(diff).toFixed(2)}/mo`;
        const card = document.createElement('div');
        card.className = 'alert-card alert-price-hike';
        card.innerHTML = `
          <span class="alert-icon">📈</span>
          <div class="alert-content">
            <div class="alert-title">Price Update: ${this.escapeHtml(sub.name)}</div>
            <div class="alert-desc">Rate updated from $${sub.priceHike.originalPrice.toFixed(2)} to $${sub.priceHike.newPrice.toFixed(2)} (${diffText}).</div>
          </div>
          <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
        `;
        container.appendChild(card);
      }
    });

    // 3. Trial countdown alert (within 24 hours)
    const trialSubs = activeSubs.filter(s => s.isTrial);
    trialSubs.forEach(sub => {
      if (sub.trialEnd) {
        const end = new Date(sub.trialEnd);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const msDiff = end.getTime() - today.getTime();
        const daysDiff = Math.ceil(msDiff / (1000 * 60 * 60 * 24));
        
        if (daysDiff >= 0 && daysDiff <= 1) {
          const card = document.createElement('div');
          card.className = 'alert-card alert-trial';
          card.innerHTML = `
            <span class="alert-icon">⏳</span>
            <div class="alert-content">
              <div class="alert-title">Free Trial Countdown</div>
              <div class="alert-desc"><strong>${this.escapeHtml(sub.name)}</strong> trial ends in 24 hours. A recurring cost of $${sub.price.toFixed(2)}/mo starts tomorrow.</div>
              <button class="alert-action-btn" onclick="app.openCancelWizard(${sub.id})">Cancel Sub</button>
            </div>
            <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
          `;
          container.appendChild(card);
        } else if (daysDiff < 0) {
          const card = document.createElement('div');
          card.className = 'alert-card alert-trial expired';
          card.innerHTML = `
            <span class="alert-icon">🚨</span>
            <div class="alert-content">
              <div class="alert-title">Trial Expired: ${this.escapeHtml(sub.name)}</div>
              <div class="alert-desc">Your free trial ended on ${this.formatDate(sub.trialEnd)}. You are now being charged $${sub.price.toFixed(2)}/mo.</div>
              <button class="alert-action-btn" onclick="app.openCancelWizard(${sub.id})">Cancel Sub</button>
            </div>
            <button class="alert-close" onclick="this.parentElement.remove()">✕</button>
          `;
          container.appendChild(card);
        }
      }
    });
  }

  // Render list of active/cancelled subscriptions
  renderSubscriptionsList() {
    const container = document.getElementById('subs-list-container');
    if (!container) return;
    container.innerHTML = '';

    const query = document.getElementById('search-input') ? document.getElementById('search-input').value.toLowerCase() : '';

    const filtered = this.subscriptions.filter(sub => {
      const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
      const matchesSearch = sub.name.toLowerCase().includes(query) || sub.category.toLowerCase().includes(query);
      return matchesScope && matchesSearch;
    });

    if (filtered.length === 0) {
      // Check if there are truly no subs for this scope (not just filtered out)
      const hasAnyScopeData = this.subscriptions.some(s =>
        this.currentScope === 'team' ? s.isTeam : !s.isTeam
      );
      if (!hasAnyScopeData) {
        container.innerHTML = `
          <div class="subs-empty-state">
            <div class="subs-empty-icon">📋</div>
            <h3 class="subs-empty-title">No subscriptions yet</h3>
            <p class="subs-empty-desc">Add your first subscription to start tracking your monthly spend and get renewal alerts.</p>
            <button class="btn btn-primary subs-empty-cta" onclick="app.switchTab('add')">+ Add Subscription</button>
          </div>
        `;
      } else {
        container.innerHTML = `<div class="text-center text-muted" style="padding: 40px 0; font-size:13px;">No results match your search.</div>`;
      }
      return;
    }

    filtered.forEach(sub => {
      const item = document.createElement('div');
      item.className = `sub-item ${sub.isCancelled ? 'cancelled-style' : ''}`;
      
      const badgeHTML = sub.isTrial 
        ? `<span class="sub-badge trial">Trial</span>` 
        : (this.currentScope === 'team' ? `<span class="sub-badge team-owner">${this.escapeHtml(sub.owner.split(' ')[0])}</span>` : '');

      const cancelBtnHTML = sub.isCancelled
        ? `<div class="cancelled-actions-row">
             <span class="status-cancelled-badge">Cancelled</span>
             <button type="button" class="btn-reactivate-sub" onclick="app.reactivateSubscription(${sub.id})" title="Reactivate subscription">Reactivate</button>
             <button type="button" class="btn-delete-sub" onclick="app.deleteSubscription(${sub.id})" title="Delete permanently">✕</button>
           </div>`
        : `<button class="btn-cancel-action" onclick="app.openCancelWizard(${sub.id})">Cancel</button>`;

      const priceDisplay = sub.isTrial && !sub.isCancelled ? 'Free' : `$${parseFloat(sub.price).toFixed(2)}`;

      item.innerHTML = `
        <div class="sub-item-left">
          <div class="sub-logo">${this.escapeHtml(sub.name.charAt(0))}</div>
          <div class="sub-info">
            <h3>${this.escapeHtml(sub.name)}</h3>
            <div class="sub-meta">
              <span>${this.escapeHtml(sub.category)}</span> • 
              <span>${sub.isCancelled ? 'Ended' : 'Renews ' + this.formatDate(sub.nextRenewal)}</span>
              ${badgeHTML}
            </div>
          </div>
        </div>
        <div class="sub-item-right">
          <div class="sub-price">${priceDisplay}</div>
          <div class="sub-interval">${sub.cycle === 'monthly' ? '/mo' : '/yr'}</div>
          ${cancelBtnHTML}
        </div>
      `;
      container.appendChild(item);
    });
  }

  // Filter subscriptions when typing
  filterSubscriptions() {
    this.renderSubscriptionsList();
  }

  // Renders the Calendar Heatmap (Grid of Days)
  renderCalendarHeatmap() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Update Month Display Title
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthTitle = document.getElementById('calendar-month-title');
    if (monthTitle) {
      monthTitle.innerText = `${monthNames[this.calendarMonth]} ${this.calendarYear}`;
    }

    // Dynamic month calculations
    const firstDay = new Date(this.calendarYear, this.calendarMonth, 1);
    const startDayOfWeek = firstDay.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const totalDays = new Date(this.calendarYear, this.calendarMonth + 1, 0).getDate();

    // Render empty spaces
    for (let i = 0; i < startDayOfWeek; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-day level-0';
      emptyCell.style.opacity = '0.2';
      grid.appendChild(emptyCell);
    }

    // Active subscriptions list for checking renewals
    const activeSubs = this.subscriptions.filter(sub => {
      const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
      return matchesScope && !sub.isCancelled;
    });

    // Populate day cells
    const simulatedTodayStr = this.todayStr();
    for (let day = 1; day <= totalDays; day++) {
      const monthStr = (this.calendarMonth + 1).toString().padStart(2, '0');
      const dayStr = day.toString().padStart(2, '0');
      const dateString = `${this.calendarYear}-${monthStr}-${dayStr}`;
      
      // Calculate total cost renewing on this day
      let dailySum = 0;
      let daySubs = [];
      activeSubs.forEach(sub => {
        if (sub.nextRenewal === dateString) {
          dailySum += parseFloat(sub.price);
          daySubs.push(sub);
        }
      });

      // Shading level based on sum
      let level = 0;
      if (dailySum > 0) {
        if (dailySum <= 12) level = 1;
        else if (dailySum <= 30) level = 2;
        else level = 3;
      }

      const dayCell = document.createElement('div');
      const isToday = dateString === simulatedTodayStr;
      dayCell.className = `calendar-day level-${level} ${isToday ? 'today' : ''}`;
      dayCell.title = dailySum > 0 ? `${daySubs.map(s => s.name).join(', ')} ($${dailySum.toFixed(2)})` : `No renewals`;
      
      dayCell.onclick = () => this.highlightOutflowDay(dateString, daySubs);

      dayCell.innerHTML = `
        <span class="day-num">${day}</span>
        ${daySubs.length > 0 ? `<div class="day-dot"></div>` : ''}
      `;
      grid.appendChild(dayCell);
    }
  }

  prevMonth() {
    this.calendarMonth--;
    if (this.calendarMonth < 0) {
      this.calendarMonth = 11;
      this.calendarYear--;
    }
    this.renderCalendarHeatmap();
  }

  nextMonth() {
    this.calendarMonth++;
    if (this.calendarMonth > 11) {
      this.calendarMonth = 0;
      this.calendarYear++;
    }
    this.renderCalendarHeatmap();
  }

  // Renders outflows listing under the Calendar
  renderUpcomingOutflows() {
    const container = document.getElementById('outflows-list');
    if (!container) return;
    container.innerHTML = '';

    const activeSubs = this.subscriptions.filter(sub => {
      const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
      return matchesScope && !sub.isCancelled;
    });

    // Sort by renewal date
    const sorted = [...activeSubs].sort((a, b) => new Date(a.nextRenewal) - new Date(b.nextRenewal));

    if (sorted.length === 0) {
      container.innerHTML = `<div class="text-center text-muted" style="font-size:11px;">No upcoming renewals.</div>`;
      return;
    }

    sorted.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'outflow-item';
      item.innerHTML = `
        <span class="outflow-date">${this.formatDate(sub.nextRenewal)}</span>
        <span class="outflow-name">${this.escapeHtml(sub.name)}</span>
        <span class="outflow-price">$${parseFloat(sub.price).toFixed(2)}</span>
      `;
      container.appendChild(item);
    });
  }

  // Callback when user clicks a day on the calendar
  highlightOutflowDay(dateStr, subs) {
    const container = document.getElementById('outflows-list');
    if (!container) return;

    if (subs.length === 0) {
      container.innerHTML = `
        <div class="text-center text-muted" style="padding: 10px 0; font-size:11px;">
          No renewals on ${this.formatDate(dateStr)}.
          <br><a href="#" onclick="app.renderUpcomingOutflows(); return false;" style="color:var(--text-secondary); text-decoration:underline;">Show all upcoming</a>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="font-size: 11px; color: var(--text-tertiary); margin-bottom: 6px; display:flex; justify-content:space-between; align-items:center;">
        <span>Selected date: ${this.formatDate(dateStr)}</span>
        <a href="#" onclick="app.renderUpcomingOutflows(); return false;" style="color:var(--text-primary); font-weight:700; text-decoration:none;">✕ Clear</a>
      </div>
    `;

    subs.forEach(sub => {
      const item = document.createElement('div');
      item.className = 'outflow-item';
      item.innerHTML = `
        <span class="outflow-date">Due Today</span>
        <span class="outflow-name">${this.escapeHtml(sub.name)}</span>
        <span class="outflow-price">$${parseFloat(sub.price).toFixed(2)}</span>
      `;
      container.appendChild(item);
    });
  }

  // Renders the insights panel (Redundancy + Analytics)
  renderAnalytics() {
    // 1. Redundancy Card
    const duplicates = this.detectRedundancies();
    const countBadge = document.getElementById('redundancy-count');
    const listContainer = document.getElementById('redundancy-list');
    
    if (countBadge && listContainer) {
      countBadge.innerText = `${duplicates.length} alert${duplicates.length === 1 ? '' : 's'}`;
      listContainer.innerHTML = '';
      
      if (duplicates.length === 0) {
        listContainer.innerHTML = `<div class="text-muted" style="font-size:11px; text-align:center;">No redundant services detected.</div>`;
      } else {
        duplicates.forEach(dup => {
          const item = document.createElement('div');
          item.className = 'redundancy-item';
          item.innerHTML = `
            <div class="redundancy-warning-header">Overlap Found</div>
            <div class="redundancy-subs">
              <span><strong>${this.escapeHtml(dup.sub1.name)}</strong> vs <strong>${this.escapeHtml(dup.sub2.name)}</strong></span>
              <button class="btn-cancel-action" onclick="app.openRedundancyReview(${dup.sub1.id}, ${dup.sub2.id})">Compare & Resolve</button>
            </div>
          `;
          listContainer.appendChild(item);
        });
      }
    }

    // 2. Category distribution
    const catContainer = document.getElementById('category-breakdown');
    if (catContainer) {
      catContainer.innerHTML = '';
      const activeSubs = this.subscriptions.filter(sub => {
        const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
        return matchesScope && !sub.isCancelled;
      });

      // Group by category
      const categories = {};
      let totalSpent = 0;
      activeSubs.forEach(sub => {
        const price = parseFloat(sub.price);
        const monthly = sub.cycle === 'monthly' ? price : (price / 12);
        categories[sub.category] = (categories[sub.category] || 0) + monthly;
        totalSpent += monthly;
      });

      if (totalSpent === 0) {
        catContainer.innerHTML = `<div class="text-muted" style="font-size:11px; text-align:center; padding:15px 0;">No active subscriptions.</div>`;
      } else {
        Object.entries(categories).sort((a,b) => b[1] - a[1]).forEach(([name, amount]) => {
          const percentage = (amount / totalSpent) * 100;
          const row = document.createElement('div');
          row.className = 'cat-row';
          row.innerHTML = `
            <div class="cat-labels">
              <span class="cat-name">${this.escapeHtml(name)}</span>
              <span class="cat-amt">$${amount.toFixed(2)}/mo (${percentage.toFixed(0)}%)</span>
            </div>
            <div class="cat-bar-bg">
              <div class="cat-bar-fill" style="width: ${percentage}%"></div>
            </div>
          `;
          catContainer.appendChild(row);
        });
      }
    }

    // 3. Stats widgets
    const activeSubs = this.subscriptions.filter(s => !s.isCancelled && (this.currentScope === 'team' ? s.isTeam : !s.isTeam));
    const totalCount = activeSubs.length;
    const trialCount = activeSubs.filter(s => s.isTrial).length;

    document.getElementById('stats-total-subs').innerText = totalCount;
    document.getElementById('stats-trial-subs').innerText = trialCount;
  }

  // Redundancy detector logic (e.g. overlap in category keywords or pre-defined duplicate pairs)
  detectRedundancies() {
    const duplicates = [];
    const isTeamScope = this.currentScope === 'team';
    const activeSubs = this.subscriptions.filter(s => !s.isCancelled && (isTeamScope ? s.isTeam : !s.isTeam));
    
    // Check specific pairs
    const checkPair = (name1, name2) => {
      const sub1 = activeSubs.find(s => s.name.toLowerCase() === name1.toLowerCase());
      const sub2 = activeSubs.find(s => s.name.toLowerCase() === name2.toLowerCase());
      if (sub1 && sub2) {
        const isDismissed = this.dismissedRedundancies.some(pair => 
          (pair.includes(sub1.id) && pair.includes(sub2.id))
        );
        if (!isDismissed) {
          duplicates.push({ sub1, sub2 });
        }
      }
    };

    if (isTeamScope) {
      checkPair('Slack Pro', 'Microsoft Teams');
      checkPair('ChatGPT Plus', 'Claude Pro');
      checkPair('Zoom Pro', 'Google Meet');
    } else {
      checkPair('Spotify', 'Apple Music');
      checkPair('Netflix', 'Prime Video');
    }
    return duplicates;
  }

  // Toggle Trial End Date field depending on checkbox
  toggleTrialDate(checkbox) {
    const trialGroup = document.getElementById('trial-date-group');
    const renewalGroup = document.getElementById('renewal-date-group');
    if (checkbox.checked) {
      trialGroup.style.display = 'block';
      renewalGroup.style.display = 'none';
      document.getElementById('sub-trial-end').required = true;
      document.getElementById('sub-renewal-date').required = false;
    } else {
      trialGroup.style.display = 'none';
      renewalGroup.style.display = 'block';
      document.getElementById('sub-trial-end').required = false;
      document.getElementById('sub-renewal-date').required = true;
    }
  }

  // Add subscription form submit handler
  handleAddSubscription(event) {
    event.preventDefault();
    
    const name = document.getElementById('sub-name').value.trim().replace(/\s+/g, ' ');
    const price = parseFloat(document.getElementById('sub-price').value);
    const cycle = document.getElementById('sub-cycle').value;
    const category = document.getElementById('sub-category').value;
    const isTrial = document.getElementById('sub-is-trial').checked;
    const cardSelect = document.getElementById('sub-card-binding');
    const cardId = cardSelect ? cardSelect.value : (this.currentScope === 'team' ? 'c2' : 'c1');
    
    const isTeam = this.currentScope === 'team';
    const exists = this.subscriptions.find(s => s.name.toLowerCase() === name.toLowerCase() && s.isTeam === isTeam && !s.isCancelled);
    if (exists) {
      alert(`An active subscription for "${name}" already exists in your ${this.currentScope} stack.`);
      return;
    }

    let nextRenewal = '';
    let trialEnd = null;

    if (isTrial) {
      trialEnd = document.getElementById('sub-trial-end').value;
      // Renewal starts the day after trial ends
      const date = new Date(trialEnd);
      date.setDate(date.getDate() + 1);
      nextRenewal = date.toISOString().split('T')[0];
    } else {
      nextRenewal = document.getElementById('sub-renewal-date').value;
    }

    const newSub = {
      id: Date.now(),
      name,
      price,
      cycle,
      category,
      nextRenewal,
      isTrial,
      trialEnd,
      isCancelled: false,
      isTeam: isTeam,
      owner: this.userName !== 'You' ? `${this.userName} (You)` : 'You',
      priceHike: null,
      cardId: cardId
    };

    if (isTeam) {
      newSub.seatsPurchased = 1;
      newSub.seatsAssigned = 1;
      newSub.pricePerSeat = price;
    }

    this.subscriptions.push(newSub);
    this.saveState();
    this.renderAll();

    // Reset Form
    document.getElementById('add-subscription-form').reset();
    document.getElementById('trial-date-group').style.display = 'none';
    document.getElementById('renewal-date-group').style.display = 'block';

    // Show Success Toast
    this.showToast('✅ Added Subscription', `${name} ($${price.toFixed(2)}) added to your active stack.`, newSub.id);
    
    // Switch back to list tab
    this.switchTab('list');
  }

  // Switch between Tab Panels
  switchTab(tabId) {
    this.currentTab = tabId;
    
    // Update tab bar UI
    document.querySelectorAll('.app-tabs .tab-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Show panel
    document.querySelectorAll('.view-panels .tab-panel').forEach(panel => {
      if (panel.id === `panel-${tabId}`) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });

    // Special render on calendar view for fresh redraw
    if (tabId === 'calendar') {
      this.renderCalendarHeatmap();
    }
  }

  // Switch between Personal & Team view scope
  switchScope(scope) {
    this.currentScope = scope;
    const pill = document.getElementById('segment-pill');
    const buttons = document.querySelectorAll('.segment-btn');

    if (scope === 'team') {
      pill.style.transform = 'translateX(100%)';
      buttons[0].classList.remove('active');
      buttons[1].classList.add('active');
    } else {
      pill.style.transform = 'translateX(0)';
      buttons[0].classList.add('active');
      buttons[1].classList.remove('active');
    }

    // Refresh view
    this.renderAll();
  }

  // GMAIL SCANNER LOGIC
  openGmailModal() {
    this.renderConnectedEmails();
    document.getElementById('gmail-step-connect').classList.remove('d-none');
    document.getElementById('gmail-step-scanning').classList.add('d-none');
    document.getElementById('gmail-step-results').classList.add('d-none');
    document.getElementById('gmail-scanner-modal').classList.add('active');
  }

  renderConnectedEmails() {
    const list = document.getElementById('connected-emails-list');
    if (!list) return;
    list.innerHTML = '';

    this.connectedEmails.forEach((email) => {
      const item = document.createElement('div');
      item.className = 'connected-email-item';
      
      const escapedEmail = this.escapeHtml(email);
      const jsEscapedEmail = email.replace(/'/g, "\\'");
      const removeBtn = this.connectedEmails.length > 1
        ? `<button type="button" class="btn-remove-email" onclick="app.removeConnectedEmail('${jsEscapedEmail}')">Remove</button>`
        : '';

      item.innerHTML = `
        <div class="connected-email-left">
          <svg class="connected-email-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
            <polyline points="22,6 12,13 2,6"></polyline>
          </svg>
          <span class="connected-email-address">${escapedEmail}</span>
        </div>
        ${removeBtn}
      `;
      list.appendChild(item);
    });

    const scanBtn = document.getElementById('btn-scan-inboxes');
    if (scanBtn) {
      scanBtn.innerText = `Connect & Scan ${this.connectedEmails.length} Inbox${this.connectedEmails.length > 1 ? 'es' : ''}`;
    }
  }

  addConnectedEmail() {
    const input = document.getElementById('link-email-input');
    if (!input) return;
    const email = input.value.trim().toLowerCase();
    
    // Strict email regex validation to block special chars (like quotes/angle brackets)
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address.');
      return;
    }

    if (this.connectedEmails.includes(email)) {
      alert('This email is already connected.');
      return;
    }

    this.connectedEmails.push(email);
    this.saveState();
    this.renderConnectedEmails();
    input.value = '';
    this.showToast('✉️ Inbox Linked', `${this.escapeHtml(email)} has been successfully added to your scan queue.`);
  }

  removeConnectedEmail(email) {
    if (this.connectedEmails.length <= 1) {
      alert('At least one connected email is required.');
      return;
    }
    this.connectedEmails = this.connectedEmails.filter(e => e !== email);
    this.saveState();
    this.renderConnectedEmails();
    this.showToast('🗑️ Inbox Removed', `${this.escapeHtml(email)} was disconnected from Subscript.`);
  }

  closeGmailModal() {
    document.getElementById('gmail-scanner-modal').classList.remove('active');
    this.clearActiveTimeouts();
  }

  startGmailScan() {
    document.getElementById('gmail-step-connect').classList.add('d-none');
    document.getElementById('gmail-step-scanning').classList.remove('d-none');
    
    const fill = document.getElementById('scan-progress-fill');
    const statusText = document.getElementById('scanning-status-text');
    const logger = document.getElementById('detected-log');
    
    fill.style.width = '0%';
    logger.innerHTML = '';

    // Generate dynamic scan sequence logs based on the connected emails list
    const logs = [];
    let currentDelay = 0;

    // Scan each connected email inbox
    this.connectedEmails.forEach((email, emailIdx) => {
      logs.push({ text: `Connecting to secure mail servers for ${email}...`, delay: currentDelay + 400 });
      logs.push({ text: `Accessing secure OAuth handshake token for ${email}...`, delay: currentDelay + 800 });
      logs.push({ text: `Searching headers in ${email} for "invoice", "receipt", "subscription"...`, delay: currentDelay + 1400 });
      
      // Distribute the preset scannable subscriptions among connected emails
      if (emailIdx === 0) {
        logs.push({ text: `Found Adobe Receipt (Adobe Creative Cloud) in ${email} - billing@adobe.com`, delay: currentDelay + 2000, detected: 0, detectedEmail: email });
        logs.push({ text: `Found Amazon Web Services invoice (AWS Cloud Services) in ${email} - billing@amazon.com`, delay: currentDelay + 2600, detected: 1, detectedEmail: email });
      } else if (emailIdx === 1) {
        logs.push({ text: `Found Google Pay receipt (Google One 100GB) in ${email} - payments-noreply@google.com`, delay: currentDelay + 2000, detected: 2, detectedEmail: email });
      } else if (emailIdx === 2) {
        logs.push({ text: `Found Zoom Invoice (Zoom Pro) in ${email} - billing@zoom.us`, delay: currentDelay + 2000, detected: 3, detectedEmail: email });
      } else {
        // Fallback for extra custom emails
        logs.push({ text: `Inbox ${email} successfully scanned. 0 new matches.`, delay: currentDelay + 2000 });
      }

      currentDelay += 2800;
    });

    logs.push({ text: 'Parsing metadata, tax statements, and billing cycles...', delay: currentDelay + 400 });
    logs.push({ text: 'Analyzing recurrence interval tokens...', delay: currentDelay + 1000 });
    logs.push({ text: `Scan complete! 4 matches detected across ${this.connectedEmails.length} inbox${this.connectedEmails.length > 1 ? 'es' : ''}.`, delay: currentDelay + 1600 });

    const totalDuration = currentDelay + 1600;

    logs.forEach(log => {
      this.scheduleTimeout(() => {
        const item = document.createElement('div');
        item.className = 'detected-log-item';
        
        if (log.detected !== undefined) {
          item.className = 'detected-log-item success';
          item.innerText = `🔍 DETECTED in ${log.detectedEmail}: ${this.gmailScannable[log.detected].name} ($${this.gmailScannable[log.detected].price.toFixed(2)}/mo)`;
          // Temporarily attach dynamic source email
          this.gmailScannable[log.detected].detectedEmail = log.detectedEmail;
        } else {
          item.innerText = `> ${log.text}`;
        }
        
        logger.appendChild(item);
        logger.scrollTop = logger.scrollHeight;

        // Update progress bar percentage
        const pct = (log.delay / totalDuration) * 100;
        fill.style.width = `${pct}%`;

        // Update status text
        if (log.delay < currentDelay * 0.3) statusText.innerText = 'Connecting to Google APIs...';
        else if (log.delay < currentDelay * 0.8) statusText.innerText = 'Analyzing invoice receipts...';
        else statusText.innerText = 'Compiling list...';

      }, log.delay);
    });

    // Complete scan -> show results
    this.scheduleTimeout(() => {
      this.renderDetectedGmailList();
      document.getElementById('gmail-step-scanning').classList.add('d-none');
      document.getElementById('gmail-step-results').classList.remove('d-none');
    }, totalDuration + 400);
  }

  renderDetectedGmailList() {
    const container = document.getElementById('detected-list-container');
    container.innerHTML = '';
    this.selectedDetectedSubs = [...this.gmailScannable]; // default select all

    this.gmailScannable.forEach((sub, idx) => {
      const subEmail = sub.detectedEmail || this.connectedEmails[0];
      const rowContainer = document.createElement('div');
      rowContainer.className = 'detected-item-row-container';
      rowContainer.style.border = '1px solid var(--border-color)';
      rowContainer.style.borderRadius = 'var(--radius-sm)';
      rowContainer.style.marginBottom = '8px';
      rowContainer.style.backgroundColor = 'var(--bg-card)';

      rowContainer.innerHTML = `
        <div class="detected-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px;">
          <div class="detected-item-left">
            <label class="checkbox-container">
              <input type="checkbox" checked onchange="app.toggleDetectedSubSelection(${idx}, this)">
              <span class="checkmark"></span>
              <div>
                <div class="detected-item-name" id="name-display-${idx}">${this.escapeHtml(sub.name)}</div>
                <div class="detected-item-price" id="meta-display-${idx}">$${sub.price.toFixed(2)}/mo • Category: ${this.escapeHtml(sub.category)}</div>
                <div style="font-size: 9px; color: var(--text-tertiary); margin-top: 2px;">Source: ${this.escapeHtml(subEmail)}</div>
              </div>
            </label>
          </div>
          <div class="detected-item-edit-trigger" onclick="app.toggleScanAccordion(${idx})" style="padding: 4px; cursor: pointer; display: flex; align-items: center;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" id="arrow-${idx}" style="transition: transform 0.2s ease;">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>
        
        <div class="detected-item-edit-panel" id="panel-${idx}">
          <div class="detected-edit-row">
            <div class="detected-edit-group">
              <label>Name</label>
              <input type="text" value="${this.escapeHtml(sub.name)}" oninput="app.updateScanItem(${idx}, 'name', this.value)">
            </div>
            <div class="detected-edit-group">
              <label>Price ($)</label>
              <input type="number" step="0.01" value="${this.escapeHtml(sub.price)}" oninput="app.updateScanItem(${idx}, 'price', this.value)">
            </div>
          </div>
          <div class="detected-edit-row">
            <div class="detected-edit-group">
              <label>Category</label>
              <select onchange="app.updateScanItem(${idx}, 'category', this.value)">
                <option value="Entertainment" ${sub.category === 'Entertainment' ? 'selected' : ''}>Entertainment</option>
                <option value="SaaS & Dev Tools" ${sub.category === 'SaaS & Dev Tools' ? 'selected' : ''}>SaaS & Dev Tools</option>
                <option value="Productivity" ${sub.category === 'Productivity' ? 'selected' : ''}>Productivity</option>
                <option value="Utilities" ${sub.category === 'Utilities' ? 'selected' : ''}>Utilities</option>
                <option value="Music" ${sub.category === 'Music' ? 'selected' : ''}>Music</option>
                <option value="Other" ${sub.category === 'Other' ? 'selected' : ''}>Other</option>
              </select>
            </div>
            <div class="detected-edit-group">
              <label>Billing Cycle</label>
              <select onchange="app.updateScanItem(${idx}, 'cycle', this.value)">
                <option value="monthly" ${(sub.cycle || 'monthly') === 'monthly' ? 'selected' : ''}>Monthly</option>
                <option value="yearly" ${(sub.cycle || 'monthly') === 'yearly' ? 'selected' : ''}>Yearly</option>
              </select>
            </div>
          </div>
        </div>
      `;
      container.appendChild(rowContainer);
    });

    document.getElementById('detected-count').innerText = this.gmailScannable.length;
    this.updateImportBtnCount();
  }

  toggleScanAccordion(idx) {
    const panel = document.getElementById(`panel-${idx}`);
    const arrow = document.getElementById(`arrow-${idx}`);
    if (panel) {
      const isExpanded = panel.style.display === 'flex';
      panel.style.display = isExpanded ? 'none' : 'flex';
      if (arrow) {
        arrow.style.transform = isExpanded ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    }
  }

  updateScanItem(idx, field, value) {
    const sub = this.gmailScannable[idx];
    if (!sub) return;

    if (field === 'price') {
      sub.price = parseFloat(value) || 0;
    } else {
      sub[field] = value;
    }

    const nameDisplay = document.getElementById(`name-display-${idx}`);
    const metaDisplay = document.getElementById(`meta-display-${idx}`);

    if (nameDisplay) nameDisplay.innerText = sub.name;
    if (metaDisplay) {
      const cycleText = (sub.cycle || 'monthly') === 'monthly' ? 'mo' : 'yr';
      metaDisplay.innerText = `$${sub.price.toFixed(2)}/${cycleText} • Category: ${sub.category}`;
    }
  }

  toggleDetectedSubSelection(idx, checkbox) {
    const sub = this.gmailScannable[idx];
    if (checkbox.checked) {
      if (!this.selectedDetectedSubs.some(s => s === sub)) {
        this.selectedDetectedSubs.push(sub);
      }
    } else {
      this.selectedDetectedSubs = this.selectedDetectedSubs.filter(s => s !== sub);
    }
    this.updateImportBtnCount();
  }

  updateImportBtnCount() {
    const count = this.selectedDetectedSubs.length;
    document.getElementById('import-btn-count').innerText = count;
  }

  importSelectedGmailSubs() {
    this.selectedDetectedSubs.forEach(sub => {
      // Don't duplicate if already added
      const exists = this.subscriptions.find(s => s.name === sub.name && !s.isCancelled);
      if (!exists) {
        // Set a random renewal date in next 30 days
        const daysAhead = Math.floor(Math.random() * 25) + 3;
        const renewalDate = new Date();
        renewalDate.setDate(renewalDate.getDate() + daysAhead);

        this.subscriptions.push({
          id: Date.now() + Math.random(),
          name: sub.name,
          price: sub.price,
          cycle: sub.cycle || 'monthly',
          category: sub.category,
          nextRenewal: renewalDate.toISOString().split('T')[0],
          isTrial: false,
          trialEnd: null,
          isCancelled: false,
          isTeam: this.currentScope === 'team',
          owner: 'Alex (You)',
          priceHike: null,
          cardId: this.currentScope === 'team' ? 'c2' : 'c1',
          detectedEmail: sub.detectedEmail || this.connectedEmails[0]
        });
      }
    });

    this.saveState();
    this.renderAll();
    this.closeGmailModal();
    this.showToast('📥 Imports Complete', `Imported ${this.selectedDetectedSubs.length} subscriptions into your stack.`, 'bulk-import');
    if (!this.onboardingCompleted) {
      this.completeOnboarding();
    } else {
      this.switchTab('list');
    }
  }

  // ONE-CLICK CANCELLATION WIZARD LOGIC
  openCancelWizard(subId) {
    const sub = this.subscriptions.find(s => s.id === subId);
    if (!sub) return;

    this.activeCancelSub = sub;

    // Set summary detail
    document.getElementById('cancel-sub-logo').innerText = sub.name.charAt(0);
    document.getElementById('cancel-sub-name').innerText = sub.name;
    document.getElementById('cancel-sub-detail').innerText = `$${parseFloat(sub.price).toFixed(2)}/mo • Renews ${this.formatDate(sub.nextRenewal)}`;

    // Reset stages
    document.getElementById('cancel-stage-intro').classList.remove('d-none');
    document.getElementById('cancel-stage-auto').classList.add('d-none');
    document.getElementById('cancel-stage-template').classList.add('d-none');
    document.getElementById('cancel-stage-success').classList.add('d-none');

    // Open modal
    document.getElementById('cancel-wizard-modal').classList.add('active');
  }

  closeCancelModal() {
    document.getElementById('cancel-wizard-modal').classList.remove('active');
    this.clearActiveTimeouts();
  }

  // Automated Cancel Option
  startAutoCancel() {
    document.getElementById('cancel-stage-intro').classList.add('d-none');
    document.getElementById('cancel-stage-auto').classList.remove('d-none');

    const term = document.getElementById('cancel-terminal-log');
    const fill = document.getElementById('cancel-progress-fill');
    const statusText = document.getElementById('bot-status-text');

    fill.style.width = '0%';
    term.innerHTML = '';
    this.clearActiveTimeouts();

    const subName = this.activeCancelSub.name;
    const domain = subName.toLowerCase().replace(/\s+/g, '') + '.com';

    const part1 = [
      { text: `cancellation-agent --target=${domain} --user=alex@office.co`, isCmd: true, delay: 0 },
      { text: `[BOT] Mapping site navigation patterns for account termination...`, delay: 400 },
      { text: `[BOT] Executing redirect to: https://www.${domain}/account/cancel`, delay: 900 },
      { text: `[BOT] Session handshake active. Submitting digital authorization key...`, delay: 1400 },
      { text: `[BOT] Overcoming retention intercept: "Free package upgrade rejected."`, delay: 2000 },
      { text: `[BOT] Security challenge detected: 2FA Verification Required.`, delay: 2600 }
    ];

    part1.forEach(cmd => {
      this.scheduleTimeout(() => {
        const line = document.createElement('div');
        line.className = 'term-log-line';
        if (cmd.isCmd) line.className += ' cmd';
        else line.className += ' done';

        line.innerText = cmd.text;
        term.appendChild(line);
        term.scrollTop = term.scrollHeight;

        const pct = (cmd.delay / 2600) * 50;
        fill.style.width = `${pct}%`;

        statusText.innerText = 'Resolving cancellation flow screens...';

        if (cmd.delay === 2600) {
          statusText.innerText = 'Verification Required';
          const twoFactorDiv = document.createElement('div');
          twoFactorDiv.className = 'bot-2fa-container';
          twoFactorDiv.id = 'bot-2fa-container-el';
          twoFactorDiv.innerHTML = `
            <div class="bot-2fa-label">Verification Code (sent to email)</div>
            <div class="bot-2fa-row">
              <input type="text" class="bot-2fa-input-field" maxlength="6" placeholder="******" id="bot-2fa-code-input">
              <button class="btn-bot-2fa-submit" onclick="app.submitBot2FA()">Verify</button>
            </div>
            <div style="font-size: 10px; color: #ef4444; display: none; margin-top: 4px;" id="bot-2fa-error">Please enter a valid 6-digit code.</div>
          `;
          term.appendChild(twoFactorDiv);
          term.scrollTop = term.scrollHeight;
        }
      }, cmd.delay);
    });
  }

  submitBot2FA() {
    const input = document.getElementById('bot-2fa-code-input');
    const errorEl = document.getElementById('bot-2fa-error');
    const code = input ? input.value.trim() : '';

    if (code.length !== 6 || isNaN(code)) {
      if (errorEl) errorEl.style.display = 'block';
      return;
    }

    const form = document.getElementById('bot-2fa-container-el');
    if (form) form.remove();

    const term = document.getElementById('cancel-terminal-log');
    const fill = document.getElementById('cancel-progress-fill');
    const statusText = document.getElementById('bot-status-text');

    const line = document.createElement('div');
    line.className = 'term-log-line success';
    line.innerText = `[BOT] Verification code ${code} accepted. Resuming...`;
    term.appendChild(line);

    const part2 = [
      { text: `[BOT] Dark pattern detected: Cancellation link nested in hidden wrapper. Bypassing...`, delay: 500 },
      { text: `[BOT] Confirming reason code: "Reason_Cost_Inefficiency"`, delay: 1200 },
      { text: `[BOT] Requesting final billing closure payload...`, delay: 1800 },
      { text: `[BOT] Capturing transaction receipt hash: #CANCEL-${Math.floor(100000 + Math.random() * 900000)}`, delay: 2400 },
      { text: `cancellation-agent terminated with exit code 0 (success)`, isCmd: true, delay: 3000 },
      { text: `[SUCCESS] Automated cancellation handshake finalized.`, isSuccess: true, delay: 3200 }
    ];

    part2.forEach(cmd => {
      this.scheduleTimeout(() => {
        const line2 = document.createElement('div');
        line2.className = 'term-log-line';
        if (cmd.isCmd) line2.className += ' cmd';
        else if (cmd.isSuccess) line2.className += ' success';
        else line2.className += ' done';

        line2.innerText = cmd.text;
        term.appendChild(line2);
        term.scrollTop = term.scrollHeight;

        const pct = 50 + (cmd.delay / 3200) * 50;
        fill.style.width = `${pct}%`;

        if (cmd.delay < 1500) statusText.innerText = 'Resolving cancellation flow screens...';
        else if (cmd.delay < 2500) statusText.innerText = 'Filing termination confirmation...';
        else statusText.innerText = 'Successfully Terminated!';
      }, cmd.delay);
    });

    this.scheduleTimeout(() => {
      const subName = this.activeCancelSub.name;
      this.activeCancelSub.isCancelled = true;
      this.saveState();
      this.renderAll();

      document.getElementById('cancel-stage-auto').classList.add('d-none');
      document.getElementById('cancel-stage-success').classList.remove('d-none');
      document.getElementById('cancel-success-message').innerText = `Cancellation confirmed. The bot successfully verified and terminated your ${subName} subscription. No further charges will occur.`;
      
      this.showToast('🚫 Cancelled', `Subscription for ${subName} has been successfully closed.`, this.activeCancelSub.id);
    }, 3600);
  }

  // Email Template option
  startManualTemplate() {
    document.getElementById('cancel-stage-intro').classList.add('d-none');
    document.getElementById('cancel-stage-template').classList.remove('d-none');

    const subName = this.activeCancelSub.name;
    const recipient = `billing@${subName.toLowerCase().replace(/\s+/g, '')}.com`;
    const userEmail = localStorage.getItem('subscript_user_email') || (this.connectedEmails && this.connectedEmails[0]) || 'user@example.com';
    const sourceEmail = this.activeCancelSub.detectedEmail || userEmail;
    
    document.getElementById('cancel-email-recipient').innerText = recipient;

    const sigName = this.userName !== 'You' ? this.userName : 'Subscriber';
    const emailBody = `To: ${recipient}
Subject: ACCOUNT CANCELLATION REQUEST - ${subName}

Dear ${subName} Billing Support,

I am writing to formally request the immediate cancellation of my subscription service for ${subName}. 

Here are my account details:
- Service Plan: Standard Subscription
- Registered Email: ${sourceEmail}
- Effective Date: Immediately (${new Date().toLocaleDateString()})

Please discontinue all recurring billing charges and confirm via reply to this email once the service has been terminated.

Sincerely,
${sigName}`;

    document.getElementById('cancel-email-body').innerText = emailBody;
  }

  copyEmailTemplate() {
    const text = document.getElementById('cancel-email-body').innerText;
    navigator.clipboard.writeText(text).then(() => {
      this.showToast('📋 Copied', 'Email template text copied to clipboard.');
    });
  }

  markAsCancelledByEmail() {
    // Mark as cancelled in state
    this.activeCancelSub.isCancelled = true;
    this.saveState();
    this.renderAll();

    document.getElementById('cancel-stage-template').classList.add('d-none');
    document.getElementById('cancel-stage-success').classList.remove('d-none');
    document.getElementById('cancel-success-message').innerText = `Status updated to "Cancelled". Make sure you have sent the generated email template to ${this.activeCancelSub.name}'s billing support to ensure final closure.`;
    
    this.showToast('🚫 Pending Closure', `${this.activeCancelSub.name} marked as cancelled.`, this.activeCancelSub.id);
  }

  // OFFICE STACK (TEAM SEATS) INVITE WIZARD
  openInviteModal() {
    document.getElementById('team-invite-modal').classList.add('active');
  }

  closeInviteModal() {
    document.getElementById('team-invite-modal').classList.remove('active');
  }

  handleInviteMember(event) {
    event.preventDefault();

    if (this.teammates.length >= 4) {
      alert('Office Stack seat limit reached (Maximum 3 invites/seats + owner).');
      return;
    }

    const name = document.getElementById('invite-name').value.trim();
    const email = document.getElementById('invite-email').value.trim().toLowerCase();
    const role = document.getElementById('invite-role').value;

    // Strict email regex validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address.');
      return;
    }

    const newTeammate = {
      id: 't' + (Date.now()),
      name,
      email,
      role,
      status: 'invited'
    };

    this.teammates.push(newTeammate);
    this.updateTeammatesUI();

    // Reset Form
    event.target.reset();

    this.showToast('✉️ Invite Sent', `Invitation email sent to ${this.escapeHtml(name)} (${this.escapeHtml(email)}).`, newTeammate.id);
  }

  updateTeammatesUI() {
    const list = document.getElementById('teammates-list');
    const countSpan = document.getElementById('active-seats-count');
    if (!list || !countSpan) return;

    list.innerHTML = '';
    countSpan.innerText = this.teammates.length;

    this.teammates.forEach(tm => {
      const initials = (tm.name || '').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '?';
      const row = document.createElement('div');
      row.className = 'teammate-row';
      
      const roleBadge = tm.status === 'invited' 
        ? `<span class="teammate-role invited">Invited</span>` 
        : `<span class="teammate-role ${tm.role === 'Owner' ? 'owner' : ''}">${this.escapeHtml(tm.role)}</span>`;

      row.innerHTML = `
        <div class="teammate-info">
          <div class="teammate-avatar">${this.escapeHtml(initials)}</div>
          <div class="teammate-details">
            <span class="teammate-name">${this.escapeHtml(tm.name)}</span>
            <span class="teammate-email">${this.escapeHtml(tm.email)}</span>
          </div>
        </div>
        ${roleBadge}
      `;
      list.appendChild(row);
    });

    // Check invite limit
    const formSubmitBtn = document.querySelector('#team-invite-modal form button');
    if (formSubmitBtn) {
      if (this.teammates.length >= 4) {
        formSubmitBtn.innerText = 'Seats Filled';
        formSubmitBtn.disabled = true;
        formSubmitBtn.style.opacity = '0.5';
        formSubmitBtn.style.cursor = 'not-allowed';
      } else {
        formSubmitBtn.innerText = 'Send Invite';
        formSubmitBtn.disabled = false;
        formSubmitBtn.style.opacity = '1';
        formSubmitBtn.style.cursor = 'pointer';
      }
    }
  }

  deleteSubscription(subId) {
    if (confirm('Are you sure you want to permanently delete this subscription from your history?')) {
      this.subscriptions = this.subscriptions.filter(s => s.id !== subId);
      this.saveState();
      this.renderAll();
      this.showToast('🗑️ Deleted', 'Subscription removed from your tracker.');
    }
  }

  reactivateSubscription(subId) {
    const sub = this.subscriptions.find(s => s.id === subId);
    if (sub) {
      sub.isCancelled = false;
      this.saveState();
      this.renderAll();
      this.showToast('✅ Reactivated', `${this.escapeHtml(sub.name)} subscription reactivated successfully.`, null, false);
    }
  }

  openRedundancyReview(subId1, subId2) {
    const sub1 = this.subscriptions.find(s => s.id === subId1);
    const sub2 = this.subscriptions.find(s => s.id === subId2);
    if (!sub1 || !sub2) return;

    const leftCard = document.getElementById('redundancy-compare-left');
    const rightCard = document.getElementById('redundancy-compare-right');
    const actionsStack = document.getElementById('redundancy-actions-stack');

    const renderCard = (element, sub) => {
      const priceText = sub.isTrial && !sub.isCancelled ? 'Free' : `$${parseFloat(sub.price).toFixed(2)}`;
      const cycleText = sub.cycle === 'monthly' ? '/mo' : '/yr';
      element.innerHTML = `
        <div class="compare-icon-wrapper">${this.escapeHtml(sub.name.charAt(0))}</div>
        <h4>${this.escapeHtml(sub.name)}</h4>
        <div class="compare-price">${priceText}${cycleText}</div>
        <div class="compare-meta">
          <div>Category: ${this.escapeHtml(sub.category)}</div>
          <div>Renewal: ${this.formatDate(sub.nextRenewal)}</div>
          <div>Owner: ${this.escapeHtml(sub.owner.split(' ')[0])}</div>
        </div>
      `;
    };

    renderCard(leftCard, sub1);
    renderCard(rightCard, sub2);

    actionsStack.innerHTML = '';

    // Keep left, cancel right
    const btnKeepLeft = document.createElement('button');
    btnKeepLeft.className = 'btn-notif-action primary';
    btnKeepLeft.innerText = `Keep ${sub1.name} & Cancel ${sub2.name}`;
    btnKeepLeft.onclick = () => {
      this.closeRedundancyModal();
      this.openCancelWizard(sub2.id);
    };

    // Keep right, cancel left
    const btnKeepRight = document.createElement('button');
    btnKeepRight.className = 'btn-notif-action primary';
    btnKeepRight.innerText = `Keep ${sub2.name} & Cancel ${sub1.name}`;
    btnKeepRight.onclick = () => {
      this.closeRedundancyModal();
      this.openCancelWizard(sub1.id);
    };

    // Keep both & dismiss warning
    const btnDismiss = document.createElement('button');
    btnDismiss.className = 'btn-notif-action secondary';
    btnDismiss.innerText = `Keep Both & Dismiss Warning`;
    btnDismiss.onclick = () => this.dismissRedundancyWarning(sub1.id, sub2.id);

    // Cancel/Close
    const btnClose = document.createElement('button');
    btnClose.className = 'btn-notif-action secondary';
    btnClose.innerText = 'Close';
    btnClose.onclick = () => this.closeRedundancyModal();

    actionsStack.appendChild(btnKeepLeft);
    actionsStack.appendChild(btnKeepRight);
    actionsStack.appendChild(btnDismiss);
    actionsStack.appendChild(btnClose);

    document.getElementById('redundancy-review-modal').classList.add('active');
  }

  closeRedundancyModal() {
    document.getElementById('redundancy-review-modal').classList.remove('active');
  }

  dismissRedundancyWarning(subId1, subId2) {
    this.dismissedRedundancies.push([subId1, subId2]);
    this.saveState();
    this.closeRedundancyModal();
    this.renderAll();
    this.showToast('✅ Overlap Resolved', 'Overlapping warning dismissed.');
  }

  renderTeamBar() {
    const bar = document.getElementById('team-members-bar');
    const avatarsList = document.getElementById('team-avatars-list');
    if (!bar || !avatarsList) return;

    if (this.currentScope === 'team') {
      bar.style.display = 'flex';
      avatarsList.innerHTML = '';
      
      // Render first 3 teammates as bubbles
      this.teammates.slice(0, 3).forEach(tm => {
        const initials = (tm.name || '').trim().split(/\s+/).map(n => n[0]).join('').toUpperCase().substring(0, 2) || '?';
        const bubble = document.createElement('div');
        bubble.className = `avatar-bubble ${tm.status === 'invited' ? 'invited' : ''}`;
        bubble.innerText = initials;
        bubble.title = `${this.escapeHtml(tm.name)} (${this.escapeHtml(tm.role)})`;
        avatarsList.appendChild(bubble);
      });
      
      // If there are more than 3, show a count bubble
      if (this.teammates.length > 3) {
        const extraBubble = document.createElement('div');
        extraBubble.className = 'avatar-bubble extra';
        extraBubble.innerText = `+${this.teammates.length - 3}`;
        extraBubble.title = `${this.teammates.length - 3} more members`;
        avatarsList.appendChild(extraBubble);
      }
    } else {
      bar.style.display = 'none';
    }
  }

  // NOTIFICATION & TOAST MANAGER
  showNotificationHistory() {
    const modal = document.getElementById('notification-modal');
    const container = document.getElementById('notifications-list-container');
    if (!modal || !container) return;

    container.innerHTML = '';

    if (this.notifications.length === 0) {
      container.innerHTML = `<div class="text-center text-muted" style="padding: 20px 0; font-size:12px;">No notification history.</div>`;
    } else {
      this.notifications.forEach(notif => {
        const item = document.createElement('div');
        item.className = 'notification-item interactive';
        item.title = 'Click to view actions';
        
        item.onclick = () => {
          this.closeNotificationModal();
          this.openNotificationActionModal(notif.id);
        };

        item.innerHTML = `
          <span class="notification-item-time">${notif.time}</span>
          <div class="notification-item-content">
            <div class="notification-item-title">${this.escapeHtml(notif.title)}</div>
            <div class="notification-item-desc">${this.escapeHtml(notif.desc)}</div>
            ${notif.subId ? `<span class="notification-interactive-badge">Action Required</span>` : ''}
          </div>
        `;
        container.appendChild(item);
      });
    }

    modal.classList.add('active');
  }

  closeNotificationModal() {
    document.getElementById('notification-modal').classList.remove('active');
  }

  openNotificationActionModal(notifId) {
    const notif = this.notifications.find(n => n.id === notifId || String(n.id) === String(notifId));
    if (!notif) return;

    // Fill title, desc
    document.getElementById('notif-action-title').innerText = notif.title;
    document.getElementById('notif-action-desc').innerText = notif.desc;

    // Resolve icon
    const iconEl = document.getElementById('notif-action-icon');
    if (notif.type === 'trial') {
      iconEl.innerText = '⏳';
    } else if (notif.type === 'price-hike') {
      iconEl.innerText = '📈';
    } else if (notif.type === 'cancel') {
      iconEl.innerText = '🚫';
    } else {
      iconEl.innerText = '🔔';
    }

    // Show details card if subId is linked
    const detailsCard = document.getElementById('notif-sub-details-card');
    let sub = null;
    if (notif.subId) {
      sub = this.subscriptions.find(s => s.id === notif.subId);
    }

    if (sub) {
      detailsCard.style.display = 'flex';
      const renewalDateFormatted = this.formatDate(sub.nextRenewal);
      const cycleText = sub.cycle === 'monthly' ? '/mo' : '/yr';
      const trialBadge = sub.isTrial ? `<span class="sub-badge trial">Trial</span>` : '';
      const priceDisplay = sub.isTrial && !sub.isCancelled ? 'Free' : `$${parseFloat(sub.price).toFixed(2)}`;
      
      detailsCard.innerHTML = `
        <div class="notif-sub-info">
          <h4>${this.escapeHtml(sub.name)}</h4>
          <span>${this.escapeHtml(sub.category)} • Renews ${renewalDateFormatted} ${trialBadge}</span>
        </div>
        <div class="notif-sub-price">${priceDisplay}${cycleText}</div>
      `;
    } else {
      detailsCard.style.display = 'none';
    }

    // Dynamic actions stack
    const actionsStack = document.getElementById('notif-actions-stack');
    actionsStack.innerHTML = '';

    if (notif.type === 'trial' && sub) {
      // Primary: Convert to Paid Sub
      const btnKeep = document.createElement('button');
      btnKeep.className = 'btn-notif-action primary';
      btnKeep.innerText = 'Convert to Paid Sub';
      btnKeep.onclick = () => this.triggerActionKeep(sub.id, notif.id);
      
      // Secondary: Snooze Alert
      const btnSnooze = document.createElement('button');
      btnSnooze.className = 'btn-notif-action secondary';
      btnSnooze.innerText = 'Snooze Alert (45s)';
      btnSnooze.onclick = () => this.triggerActionSnooze(notif.id);

      // Danger: Cancel Subscription
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn-notif-action danger';
      btnCancel.innerText = 'Cancel Subscription';
      btnCancel.onclick = () => this.triggerActionCancel(sub.id);

      actionsStack.appendChild(btnKeep);
      actionsStack.appendChild(btnSnooze);
      actionsStack.appendChild(btnCancel);
    } else if (notif.type === 'price-hike' && sub) {
      // Primary: Accept Price Hike
      const btnAccept = document.createElement('button');
      btnAccept.className = 'btn-notif-action primary';
      btnAccept.innerText = 'Accept Price Hike';
      btnAccept.onclick = () => this.triggerActionAcceptHike(sub.id, notif.id);

      // Danger: Cancel Subscription
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn-notif-action danger';
      btnCancel.innerText = 'Cancel Subscription';
      btnCancel.onclick = () => this.triggerActionCancel(sub.id);

      actionsStack.appendChild(btnAccept);
      actionsStack.appendChild(btnCancel);
    } else {
      // General alert: Dismiss Notification
      const btnDismiss = document.createElement('button');
      btnDismiss.className = 'btn-notif-action primary';
      btnDismiss.innerText = 'Dismiss Notification';
      btnDismiss.onclick = () => this.triggerActionDismiss(notif.id);
      actionsStack.appendChild(btnDismiss);
    }

    // Add a general close button for safety
    const btnClose = document.createElement('button');
    btnClose.className = 'btn-notif-action secondary';
    btnClose.innerText = 'Close';
    btnClose.onclick = () => this.closeNotificationActionModal();
    actionsStack.appendChild(btnClose);

    // Open Action Sheet Modal
    document.getElementById('notification-action-modal').classList.add('active');
  }

  closeNotificationActionModal() {
    document.getElementById('notification-action-modal').classList.remove('active');
  }

  triggerActionKeep(subId, notifId) {
    const sub = this.subscriptions.find(s => s.id === subId);
    if (sub) {
      sub.isTrial = false;
      sub.trialEnd = null;
    }
    // Remove notification from memory
    this.notifications = this.notifications.filter(n => n.id !== notifId && String(n.id) !== String(notifId));
    this.updateNotificationDot();
    this.closeNotificationActionModal();
    this.saveState();
    this.renderAll();
    
    // Pop a success toast
    this.showToast('✅ Converted to Paid', `${sub ? sub.name : 'Subscription'} converted to paid.`, null, false);
  }

  triggerActionAcceptHike(subId, notifId) {
    const sub = this.subscriptions.find(s => s.id === subId);
    if (sub) {
      // Update original price to match the hiked price so hike indicator clears
      if (sub.priceHike) {
        sub.price = sub.priceHike.newPrice;
        sub.priceHike = null;
      }
    }
    // Remove notification from memory
    this.notifications = this.notifications.filter(n => n.id !== notifId && String(n.id) !== String(notifId));
    this.updateNotificationDot();
    this.closeNotificationActionModal();
    this.saveState();
    this.renderAll();
    
    // Pop a success toast
    this.showToast('📈 Hike Accepted', `Hike accepted for ${sub ? sub.name : 'subscription'}.`, null, false);
  }

  triggerActionSnooze(notifId) {
    const notif = this.notifications.find(n => n.id === notifId || String(n.id) === String(notifId));
    const subId = notif ? notif.subId : null;
    const sub = subId ? this.subscriptions.find(s => s.id === subId) : null;
    
    // Remove notification from memory
    this.notifications = this.notifications.filter(n => n.id !== notifId && String(n.id) !== String(notifId));
    this.updateNotificationDot();
    this.closeNotificationActionModal();
    this.saveState();
    this.renderAll();
    
    // Pop snooze toast
    this.showToast('🔔 Snoozed', 'Alert snoozed for 45 seconds.', null, false);
    
    // Schedule a reminder after 45 seconds using standard setTimeout to avoid being cleared by modal closes
    setTimeout(() => {
      this.showToast(
        '🚨 Trial Ending (Snoozed)',
        `Reminder: ${sub ? sub.name : 'Figma Pro'} trial charges in 24 hours. Click to manage.`,
        subId,
        true
      );
    }, 45000);
  }

  triggerActionCancel(subId) {
    this.closeNotificationActionModal();
    this.switchTab('list');
    
    // Open cancellation wizard
    setTimeout(() => {
      this.openCancelWizard(subId);
    }, 150);
  }

  triggerActionDismiss(notifId) {
    // Remove notification from memory
    this.notifications = this.notifications.filter(n => n.id !== notifId && String(n.id) !== String(notifId));
    this.updateNotificationDot();
    this.closeNotificationActionModal();
    this.saveState();
    this.renderAll();
    
    // Pop toast
    this.showToast('🔔 Dismissed', 'Notification dismissed.', null, false);
  }

  clearNotifications() {
    this.notifications = [];
    this.updateNotificationDot();
    this.closeNotificationModal();
    this.saveState();
    this.showToast('🔔 Clear', 'Notification log cleared.', null, false);
  }

  updateNotificationDot() {
    const dot = document.getElementById('global-alert-dot');
    if (dot) {
      dot.style.display = this.notifications.length > 0 ? 'block' : 'none';
    }
  }

  // Toast System
  showToast(title, body, subId = null, addToHistory = true) {
    const toast = document.getElementById('toast-notification');
    const iconEl = document.getElementById('toast-icon');
    const titleEl = document.getElementById('toast-title');
    const bodyEl = document.getElementById('toast-body');

    // Change icon depending on action type
    if (title.includes('Cancel') || title.includes('🚫')) iconEl.innerText = '🚫';
    else if (title.includes('Add') || title.includes('✅')) iconEl.innerText = '✅';
    else if (title.includes('Trial') || title.includes('🚨')) iconEl.innerText = '🚨';
    else if (title.includes('Import') || title.includes('📥')) iconEl.innerText = '📥';
    else iconEl.innerText = '🔔';

    titleEl.innerText = title;
    bodyEl.innerText = body;

    const notifId = Date.now();

    // Add to history if enabled
    if (addToHistory) {
      let type = 'general';
      if (title.includes('Trial') || title.includes('Ending') || title.includes('🚨') || title.includes('⏳')) {
        type = 'trial';
      } else if (title.includes('Price') || title.includes('Hike') || title.includes('📈')) {
        type = 'price-hike';
      } else if (title.includes('Cancel') || title.includes('🚫')) {
        type = 'cancel';
      }

      this.notifications.unshift({
        id: notifId,
        type: type,
        title: title,
        desc: body,
        time: 'Just now',
        subId: subId
      });
      this.updateNotificationDot();
    }

    // Toast click interaction (redirect to specific item or view or open action modal)
    toast.onclick = () => {
      this.hideToast();
      if (addToHistory) {
        this.openNotificationActionModal(notifId);
      }
    };

    toast.classList.add('active');

    // Auto dismiss after 4.5 seconds
    if (this.toastTimeout) clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.hideToast();
    }, 4500);
  }

  hideToast() {
    document.getElementById('toast-notification').classList.remove('active');
  }

  // UTILITY METHODS
  formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  scheduleTimeout(fn, delay) {
    const timer = setTimeout(() => {
      this.activeTimeouts = this.activeTimeouts.filter(t => t !== timer);
      fn();
    }, delay);
    this.activeTimeouts.push(timer);
    return timer;
  }

  clearActiveTimeouts() {
    this.activeTimeouts.forEach(t => clearTimeout(t));
    this.activeTimeouts = [];
  }

  startOnboarding() {
    this.onboardingCompleted = false;
    this.onboardingBranch = null;
    this.onboardingStep = 1;

    // Hide main app views
    document.querySelector('.app-header').style.display = 'none';
    document.getElementById('app-body').style.display = 'none';
    document.querySelector('.app-tabs').style.display = 'none';

    // Show onboarding screen
    const screen = document.getElementById('onboarding-screen');
    if (screen) {
      screen.style.display = 'flex';
      this.renderOnboardingStep();
    }
  }

  selectOnboardingBranch(branch) {
    this.onboardingBranch = branch;
    this.onboardingStep = 4; // Step 4: email scan (individual) or workspace name (team)
    this.renderOnboardingStep();
  }

  renderOnboardingStep() {
    const screen = document.getElementById('onboarding-screen');
    if (!screen) return;

    screen.innerHTML = '';

    // Create container for step
    const stepContainer = document.createElement('div');
    stepContainer.style.display = 'flex';
    stepContainer.style.flexDirection = 'column';
    stepContainer.style.height = '100%';

    // ─── STEP 1: Welcome — name entry, NO SKIP allowed ───────────────────────────
    if (this.onboardingStep === 1) {
      stepContainer.innerHTML = `
        <div class="ob-splash-hero">
          <div class="ob-splash-logomark">S</div>
          <div class="ob-splash-brand">SUBSCRIPT</div>
          <p class="ob-splash-tagline">Track. Alert. Cancel.<br>Before you're charged.</p>
        </div>
        <div class="ob-welcome-form">
          <label class="ob-field-label" for="ob-user-name">YOUR NAME</label>
          <input type="text" id="ob-user-name" class="onboarding-name-input" placeholder="e.g. Alex" autocomplete="given-name" maxlength="30">
          <button type="button" class="btn btn-primary w-100 ob-get-started" onclick="app.proceedFromWelcome()">Get Started →</button>
          <p class="ob-legal-text">By continuing you agree to our Terms &amp; Privacy Policy.</p>
        </div>
      `;
      setTimeout(() => {
        const el = document.getElementById('ob-user-name');
        if (el) { if (this.userName !== 'You') el.value = this.userName; el.focus(); }
      }, 100);
    }

    // ─── STEP 2: Enable Notifications ────────────────────────────────────────────
    else if (this.onboardingStep === 2) {
      stepContainer.innerHTML = `
        <div class="ob-notif-hero">
          <div class="ob-bell-wrapper">
            <div class="ob-bell-ring"></div>
            <div class="ob-bell-ring ob-bell-ring-2"></div>
            <div class="ob-bell-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9Z"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0" fill="currentColor" stroke="none"/>
              </svg>
            </div>
          </div>
          <h2 class="ob-notif-heading">Never miss a charge</h2>
          <p class="ob-notif-sub">Get real-time alerts before your card gets hit.</p>
        </div>
        <div class="ob-notif-perks">
          <div class="ob-perk-row"><span class="ob-perk-icon">⏳</span><span><strong>Trial countdowns</strong> — know when free turns paid</span></div>
          <div class="ob-perk-row"><span class="ob-perk-icon">💳</span><span><strong>Renewal alerts</strong> — 3 days before you're charged</span></div>
          <div class="ob-perk-row"><span class="ob-perk-icon">📈</span><span><strong>Price hike warnings</strong> — spot rate changes instantly</span></div>
        </div>
        <div class="ob-notif-actions">
          <button type="button" class="btn btn-primary w-100" onclick="app.enableNotificationsStep()">🔔 Enable Notifications</button>
          <button type="button" class="ob-skip-link" onclick="app.skipNotificationsStep()">Not now, I'll check manually</button>
        </div>
      `;
    }

    // ─── STEP 3: Path Selection (Personal vs Team) ────────────────────────────────
    else if (this.onboardingStep === 3) {
      stepContainer.innerHTML = `
        <div class="onboarding-header">
          <div class="onboarding-logo">WHAT ARE YOU TRACKING?</div>
          <p class="onboarding-subtitle">Choose your focus — you can switch between views anytime.</p>
        </div>
        <div class="onboarding-cards-stack" style="flex:1;">
          <div class="onboarding-card" onclick="app.selectOnboardingBranch('individual')">
            <div class="onboarding-card-icon">👤</div>
            <div class="onboarding-card-content">
              <h3>Personal Spend</h3>
              <p>Netflix, Spotify, iCloud — track your subscriptions and cancel before you're ever charged again.</p>
            </div>
          </div>
          <div class="onboarding-card" onclick="app.selectOnboardingBranch('team')">
            <div class="onboarding-card-icon">👥</div>
            <div class="onboarding-card-content">
              <h3>Team Stack</h3>
              <p>Slack, AWS, Zoom — manage group licenses, assign seats, and eliminate wasted spend.</p>
            </div>
          </div>
        </div>
        <div class="onboarding-footer-nav">
          <div class="onboarding-progress">
            <div class="progress-dot active"></div>
            <div class="progress-dot active"></div>
            <div class="progress-dot active"></div>
            <div class="progress-dot"></div>
            <div class="progress-dot"></div>
          </div>
        </div>
      `;
    }

    // ─── STEP 4: Email Scan (individual) | Workspace Name (team) ─────────────────
    else if (this.onboardingStep === 4) {
      if (this.onboardingBranch === 'individual') {
        stepContainer.innerHTML = `
          <div class="onboarding-header">
            <div class="onboarding-logo">SCAN YOUR INBOX</div>
            <p class="onboarding-subtitle">Enter your email — Subscript finds active subscriptions from billing receipts automatically.</p>
          </div>

          <div class="import-card" style="margin-top:10px; flex:1;">
            <div class="import-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <h3>Gmail Receipt Scan</h3>
            <div class="form-group" style="margin-top:14px;">
              <label class="ob-field-label">YOUR EMAIL ADDRESS</label>
              <input type="email" id="ob-email-input" class="onboarding-name-input" placeholder="you@gmail.com" autocomplete="email">
            </div>
            <p style="font-size:10px; color:var(--text-tertiary); margin:8px 0 14px; line-height:1.5;">Subscript reads only billing receipt subject lines via OAuth. Your email content stays completely private.</p>
            <button type="button" class="btn btn-primary w-100" onclick="app.startOnboardingGmailScan()">🔍 Scan My Inbox</button>
          </div>

          <div class="onboarding-footer-nav">
            <div class="onboarding-progress">
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot"></div>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <button type="button" class="btn btn-secondary" onclick="app.setStep(3)">Back</button>
              <button type="button" class="ob-skip-link" style="font-size:11px;" onclick="app.setStep(5)">Add manually instead →</button>
            </div>
          </div>
        `;
        setTimeout(() => {
          const emailEl = document.getElementById('ob-email-input');
          if (emailEl && this.connectedEmails.length > 0) emailEl.value = this.connectedEmails[0];
        }, 50);
      } else {
        // Team Step 4: workspace name
        stepContainer.innerHTML = `
          <div class="onboarding-header">
            <div class="onboarding-logo">YOUR WORKSPACE</div>
            <p class="onboarding-subtitle">Define your team workspace to start tracking group subscription costs.</p>
          </div>

          <form id="onboarding-team-form" onsubmit="event.preventDefault(); app.saveTeamDetails();" style="margin-top:10px;">
            <div class="form-group">
              <label for="ob-team-name" class="ob-field-label">WORKSPACE NAME</label>
              <input type="text" id="ob-team-name" placeholder="e.g. Acme Corp, Design Team" required>
            </div>
            <div class="form-group">
              <label for="ob-team-category" class="ob-field-label">PRIMARY FOCUS</label>
              <select id="ob-team-category">
                <option value="Productivity & SaaS">Productivity &amp; SaaS</option>
                <option value="Design & Creatives">Design &amp; Creatives</option>
                <option value="Engineering & DevOps">Engineering &amp; DevOps</option>
                <option value="Marketing & Growth">Marketing &amp; Growth</option>
              </select>
            </div>
            <button type="submit" class="btn btn-primary w-100" style="margin-top:10px;">Continue →</button>
          </form>

          <div class="onboarding-footer-nav">
            <div class="onboarding-progress">
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot"></div>
            </div>
            <button type="button" class="btn btn-secondary align-self-start" style="width:fit-content;" onclick="app.setStep(3)">Back</button>
          </div>
        `;
      }
    }

    // ─── STEP 5: First Sub Manual Add (individual) | Team Presets (team) ──────────
    else if (this.onboardingStep === 5) {
      if (this.onboardingBranch === 'individual') {
        stepContainer.innerHTML = `
          <div class="onboarding-header">
            <div class="onboarding-logo">YOUR FIRST SUB</div>
            <p class="onboarding-subtitle">Pick a preset or enter one manually — you can add more anytime from the dashboard.</p>
          </div>

          <div class="presets-grid">
            <div class="preset-chip" onclick="app.selectPresetSub('Netflix', 15.49, 'Entertainment', 'monthly')">
              <span class="preset-name">Netflix</span><span class="preset-price">$15.49/mo</span>
            </div>
            <div class="preset-chip" onclick="app.selectPresetSub('Spotify', 10.99, 'Music', 'monthly')">
              <span class="preset-name">Spotify</span><span class="preset-price">$10.99/mo</span>
            </div>
            <div class="preset-chip" onclick="app.selectPresetSub('Notion Plus', 8.00, 'Productivity', 'monthly')">
              <span class="preset-name">Notion</span><span class="preset-price">$8.00/mo</span>
            </div>
            <div class="preset-chip" onclick="app.selectPresetSub('Figma Pro', 15.00, 'SaaS & Dev Tools', 'monthly')">
              <span class="preset-name">Figma</span><span class="preset-price">$15.00/mo</span>
            </div>
          </div>

          <form id="onboarding-sub-form" onsubmit="app.saveOnboardingSub(event)" style="gap:10px;">
            <div class="form-row">
              <div class="form-group" style="flex:2;">
                <label for="ob-sub-name">Service Name</label>
                <input type="text" id="ob-sub-name" placeholder="e.g. Netflix, Spotify" required>
              </div>
              <div class="form-group">
                <label for="ob-sub-price">Price ($)</label>
                <input type="number" id="ob-sub-price" step="0.01" placeholder="15.00" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="ob-sub-cycle">Cycle</label>
                <select id="ob-sub-cycle">
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
              <div class="form-group">
                <label for="ob-sub-renewal">Renewal Date</label>
                <input type="date" id="ob-sub-renewal" required>
              </div>
            </div>
            <input type="hidden" id="ob-sub-category" value="Entertainment">
            <button type="submit" class="btn btn-primary w-100" style="margin-top:10px;">Save &amp; Enter Dashboard →</button>
          </form>

          <div class="onboarding-footer-nav">
            <div class="onboarding-progress">
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
            </div>
            <button type="button" class="btn btn-secondary align-self-start" onclick="app.setStep(4)">Back</button>
          </div>
        `;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        setTimeout(() => {
          const el = document.getElementById('ob-sub-renewal');
          if (el) el.value = tomorrow.toISOString().split('T')[0];
        }, 50);
      } else {
        // Team Step 5: Preset selection
        stepContainer.innerHTML = `
          <div class="onboarding-header">
            <div class="onboarding-logo">TEAM SERVICES</div>
            <p class="onboarding-subtitle">Select your active team subscriptions — you can always add more later.</p>
          </div>

          <div class="presets-grid" style="margin-bottom:24px;">
            <div class="preset-chip" id="preset-slack" onclick="app.toggleOnboardingPreset('Slack Pro', 26.25, 'SaaS & Dev Tools')">
              <span class="preset-name">Slack Pro</span><span class="preset-price">$26.25/mo</span>
            </div>
            <div class="preset-chip" id="preset-zoom" onclick="app.toggleOnboardingPreset('Zoom Pro', 14.99, 'SaaS & Dev Tools')">
              <span class="preset-name">Zoom Pro</span><span class="preset-price">$14.99/mo</span>
            </div>
            <div class="preset-chip" id="preset-chatgpt" onclick="app.toggleOnboardingPreset('ChatGPT Plus', 20.00, 'Productivity')">
              <span class="preset-name">ChatGPT Plus</span><span class="preset-price">$20.00/mo</span>
            </div>
            <div class="preset-chip" id="preset-aws" onclick="app.toggleOnboardingPreset('AWS Services', 12.50, 'Utilities')">
              <span class="preset-name">AWS Cloud</span><span class="preset-price">$12.50/mo</span>
            </div>
          </div>

          <p style="font-size:11px; color:var(--text-tertiary); text-align:center; margin-bottom:16px;">Select all that apply — or skip to start with an empty stack</p>
          <button type="button" class="btn btn-primary w-100" onclick="app.saveTeamPresets()">Finish Setup →</button>

          <div class="onboarding-footer-nav">
            <div class="onboarding-progress">
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
              <div class="progress-dot active"></div>
            </div>
            <button type="button" class="btn btn-secondary align-self-start" onclick="app.setStep(4)">Back</button>
          </div>
        `;
        this.selectedOnboardingPresets = [];
      }
    }

    screen.appendChild(stepContainer);
  }

  setStep(step) {
    this.onboardingStep = step;
    this.renderOnboardingStep();
  }

  selectPresetSub(name, price, category, cycle) {
    document.getElementById('ob-sub-name').value = name;
    document.getElementById('ob-sub-price').value = price;
    document.getElementById('ob-sub-category').value = category;
    document.getElementById('ob-sub-cycle').value = cycle;

    // highlight selection
    document.querySelectorAll('.preset-chip').forEach(chip => {
      if (chip.querySelector('.preset-name').innerText === name) {
        chip.classList.add('selected');
      } else {
        chip.classList.remove('selected');
      }
    });
  }

  toggleOnboardingPreset(name, price, category) {
    const key = name.toLowerCase().split(' ')[0];
    const chip = document.getElementById('preset-' + key);
    const exists = this.selectedOnboardingPresets.find(p => p.name === name);
    
    if (exists) {
      this.selectedOnboardingPresets = this.selectedOnboardingPresets.filter(p => p.name !== name);
      if (chip) chip.classList.remove('selected');
    } else {
      this.selectedOnboardingPresets.push({ name, price, category });
      if (chip) chip.classList.add('selected');
    }
  }

  saveTeamDetails() {
    const name = document.getElementById('ob-team-name').value.trim().replace(/\s+/g, ' ');
    const category = document.getElementById('ob-team-category').value;
    this.teamName = name;
    this.teamCategory = category;
    this.setStep(5); // Step 5 = team preset selection
  }

  saveOnboardingInvite() {
    const name = document.getElementById('ob-invite-name').value.trim();
    const email = document.getElementById('ob-invite-email').value.trim().toLowerCase();
    const role = document.getElementById('ob-invite-role').value;

    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      alert('Please enter a valid email address.');
      return;
    }

    this.teammates.push({ id: 't' + Date.now(), name, email, role, status: 'invited' });
    this.showToast('✉️ Invite Sent', `Invitation sent to ${this.escapeHtml(name)} (${this.escapeHtml(email)}).`);
    this.setStep(5); // Step 5 = team presets
  }

  saveTeamPresets() {
    const ownerLabel = this.userName !== 'You' ? `${this.userName} (You)` : 'You';
    this.selectedOnboardingPresets.forEach(preset => {
      this.subscriptions.push({
        id: Date.now() + Math.random(),
        name: preset.name,
        price: preset.price,
        cycle: 'monthly',
        category: preset.category,
        nextRenewal: this.daysFromToday(5),
        isTrial: false,
        trialEnd: null,
        isCancelled: false,
        isTeam: true,
        owner: ownerLabel,
        priceHike: null
      });
    });

    this.currentScope = 'team';
    this.completeOnboarding();
  }

  saveOnboardingSub(event) {
    event.preventDefault();
    const name = document.getElementById('ob-sub-name').value.trim().replace(/\s+/g, ' ');
    const price = parseFloat(document.getElementById('ob-sub-price').value);
    const cycle = document.getElementById('ob-sub-cycle').value;
    const renewal = document.getElementById('ob-sub-renewal').value;
    const category = document.getElementById('ob-sub-category').value;

    const ownerLabel = this.userName !== 'You' ? `${this.userName} (You)` : 'You';
    this.subscriptions.push({
      id: Date.now(),
      name,
      price,
      cycle,
      category,
      nextRenewal: renewal,
      isTrial: false,
      trialEnd: null,
      isCancelled: false,
      isTeam: false,
      owner: ownerLabel,
      priceHike: null
    });

    this.currentScope = 'personal';
    this.completeOnboarding();
  }

  completeOnboarding() {
    localStorage.setItem('subscript_onboarding_completed', 'true');
    this.onboardingCompleted = true;

    // Save initial state compiled during onboarding
    this.saveState();

    // Restore visibility of main app
    document.querySelector('.app-header').style.display = 'block';
    document.getElementById('app-body').style.display = 'block';
    document.querySelector('.app-tabs').style.display = 'flex';

    // Hide onboarding overlay screen
    const screen = document.getElementById('onboarding-screen');
    if (screen) screen.style.display = 'none';

    // Adjust segment control pill positioning
    this.switchScope(this.currentScope);
    this.renderAll();

    const greeting = this.userName !== 'You' ? `Welcome, ${this.userName}!` : 'Welcome to Subscript!';
    this.showToast('🚀 Setup Complete', `${greeting} Let's manage your subscriptions.`);

    // Fire notifications immediately for any urgent subs (e.g. after Gmail scan)
    setTimeout(() => this.checkAndFireNotifications(), 2000);
  }

  skipOnboarding() {
    this.currentScope = 'personal';
    this.completeOnboarding();
  }

  resetOnboarding() {
    if (confirm('Reset all data and restart onboarding?')) {
      [
        'subscript_onboarding_completed', 'subscript_subscriptions', 'subscript_notifications',
        'subscript_dismissed_redundancies', 'subscript_user_name', 'subscript_user_email',
        'subscript_virtual_cards', 'subscript_connected_emails', 'subscript_teammates',
        'subscript_last_notif_check', 'subscript_layout_mode'
      ].forEach(k => localStorage.removeItem(k));
      window.location.reload();
    }
  }

  clearActiveTimeouts() {
    this.activeTimeouts.forEach(t => clearTimeout(t));
    this.activeTimeouts = [];
  }

  // Step 1 → Step 2: validate name (required), save it, advance
  proceedFromWelcome() {
    const nameEl = document.getElementById('ob-user-name');
    const rawName = nameEl ? nameEl.value.trim() : '';
    if (!rawName) {
      if (nameEl) {
        nameEl.style.borderColor = '#ef4444';
        nameEl.placeholder = 'Please enter your name';
        nameEl.focus();
        setTimeout(() => { nameEl.style.borderColor = ''; nameEl.placeholder = 'e.g. Alex'; }, 2000);
      }
      return;
    }
    this.userName = rawName;
    localStorage.setItem('subscript_user_name', rawName);
    this.setStep(2);
  }

  // Step 2 → Step 3: request browser notification permission
  enableNotificationsStep() {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          this.showToast('🔔 Notifications On', 'You\'ll be alerted before any subscription charges.', null, false);
        }
        this.setStep(3);
      });
    } else {
      this.setStep(3);
    }
  }

  // Step 2 → Step 3: skip notification permission
  skipNotificationsStep() {
    this.setStep(3);
  }

  // Step 4 individual: save email, open Gmail scan modal
  startOnboardingGmailScan() {
    const emailInput = document.getElementById('ob-email-input');
    const email = emailInput ? emailInput.value.trim().toLowerCase() : '';
    if (email) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        alert('Please enter a valid email address.');
        return;
      }
      this.connectedEmails = [email];
      localStorage.setItem('subscript_user_email', email);
      // Update owner teammate email
      if (this.teammates[0]) this.teammates[0].email = email;
      this.saveState();
    }
    this.openGmailModal();
  }

  // Kept for backward compatibility (no longer called from UI)
  saveNameAndBranch(branch) {
    const nameEl = document.getElementById('ob-user-name');
    const rawName = nameEl ? nameEl.value.trim() : '';
    if (rawName) { this.userName = rawName; localStorage.setItem('subscript_user_name', rawName); }
    this.selectOnboardingBranch(branch);
  }

  // Fire real browser notifications for upcoming renewals/trials (once per day)
  checkAndFireNotifications() {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;

    const today = this.todayStr();
    const lastCheck = localStorage.getItem('subscript_last_notif_check');
    if (lastCheck === today) return; // Already fired today
    localStorage.setItem('subscript_last_notif_check', today);

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    let delay = 0;
    let count = 0;

    this.subscriptions.forEach(sub => {
      if (sub.isCancelled || count >= 3) return;

      // Trial ending today or tomorrow
      if (sub.isTrial && sub.trialEnd) {
        const end = new Date(sub.trialEnd);
        const diff = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
        if (diff >= 0 && diff <= 1) {
          setTimeout(() => {
            try {
              new Notification(`⏳ ${sub.name} Trial ${diff === 0 ? 'Ends Today' : 'Ends Tomorrow'} — Subscript`, {
                body: `Your free trial expires ${diff === 0 ? 'today' : 'tomorrow'}. $${parseFloat(sub.price).toFixed(2)}/mo starts after.`,
                icon: '/icons/icon-192x192.png',
                tag: `trial-${sub.id}`
              });
            } catch(e) {}
          }, delay);
          delay += 2000;
          count++;
        }
      }

      // Renewal within 3 days
      if (!sub.isTrial && sub.nextRenewal) {
        const renewal = new Date(sub.nextRenewal);
        const diff = Math.ceil((renewal - now) / (1000 * 60 * 60 * 24));
        if (diff >= 1 && diff <= 3) {
          setTimeout(() => {
            try {
              new Notification(`💳 ${sub.name} Renews in ${diff} Day${diff !== 1 ? 's' : ''} — Subscript`, {
                body: `$${parseFloat(sub.price).toFixed(2)}/${sub.cycle === 'monthly' ? 'mo' : 'yr'} charge coming. Open Subscript to manage.`,
                icon: '/icons/icon-192x192.png',
                tag: `renewal-${sub.id}`
              });
            } catch(e) {}
          }, delay);
          delay += 2000;
          count++;
        }
      }
    });
  }

  // Feedback modal
  openFeedbackModal() {
    document.getElementById('feedback-modal').classList.add('active');
    setTimeout(() => document.getElementById('feedback-textarea').focus(), 100);
  }

  closeFeedbackModal() {
    document.getElementById('feedback-modal').classList.remove('active');
  }

  submitFeedback() {
    const text = document.getElementById('feedback-textarea').value.trim();
    if (!text) return;
    const type = document.getElementById('feedback-type').value;
    const name = this.userName !== 'You' ? this.userName : 'Tester';
    const payload = { from: name, type, message: text, ts: new Date().toISOString() };
    // Copy to clipboard so tester can share
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => {});
    console.log('[Subscript Feedback]', payload);
    document.getElementById('feedback-textarea').value = '';
    this.closeFeedbackModal();
    this.showToast('💬 Feedback Sent', 'Thanks! Your feedback has been recorded and copied to clipboard.', null, false);
  }


  renderSpendTrendChart() {
    const wrapper = document.getElementById('chart-svg-wrapper');
    if (!wrapper) return;

    const months = [];
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const nowDate = new Date();
    let cy = nowDate.getFullYear();
    let cm = nowDate.getMonth(); // current month (0-indexed)

    for (let i = 0; i < 6; i++) {
      months.push({ year: cy, month: cm, label: monthNames[cm] });
      cm++;
      if (cm > 11) {
        cm = 0;
        cy++;
      }
    }

    const spendData = months.map(m => {
      let sum = 0;
      const activeSubs = this.subscriptions.filter(sub => {
        const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
        return matchesScope && !sub.isCancelled;
      });

      activeSubs.forEach(sub => {
        let price = parseFloat(sub.price);

        // Check price hike
        if (sub.priceHike) {
          const hikeDate = new Date(sub.priceHike.date);
          const currentMonthEnd = new Date(m.year, m.month + 1, 0);
          if (currentMonthEnd >= hikeDate) {
            price = parseFloat(sub.priceHike.newPrice);
          } else {
            price = parseFloat(sub.priceHike.originalPrice);
          }
        }

        // Check trial conversion
        if (sub.isTrial && sub.trialEnd) {
          const trialEndDate = new Date(sub.trialEnd);
          const currentMonthEnd = new Date(m.year, m.month + 1, 0);
          if (currentMonthEnd < trialEndDate) {
            return; // Still free trial
          }
        }

        if (sub.cycle === 'monthly') {
          sum += price;
        } else if (sub.cycle === 'yearly') {
          sum += price / 12;
        }
      });
      return { ...m, amount: sum };
    });

    const maxAmount = Math.max(...spendData.map(d => d.amount), 50) * 1.1;

    const points = spendData.map((d, i) => {
      const x = 35 + i * 51;
      const y = 120 - (d.amount / maxAmount) * 85;
      return { x, y, amount: d.amount, ...d };
    });

    this.projectedSpendData = points;

    let gridLinesHTML = '';
    const steps = [0.25, 0.5, 0.75, 1.0];
    steps.forEach(pct => {
      const val = maxAmount * pct;
      const gy = 120 - (val / maxAmount) * 85;
      gridLinesHTML += `
        <line class="chart-grid-line" x1="30" y1="${gy}" x2="300" y2="${gy}"></line>
        <text x="25" y="${gy + 3}" style="font-size: 7px; fill: var(--text-tertiary); text-anchor: end;">$${val.toFixed(0)}</text>
      `;
    });

    let nodesHTML = '';
    points.forEach((p, idx) => {
      nodesHTML += `<circle class="chart-dot" cx="${p.x}" cy="${p.y}" r="4.5" onmouseover="app.showChartTooltip(event, ${idx}, ${p.x}, ${p.y})" onmouseout="app.hideChartTooltip()"></circle>`;
    });

    let labelsHTML = '';
    points.forEach((p) => {
      labelsHTML += `<text class="chart-text" x="${p.x}" y="140">${p.label}</text>`;
    });

    const pathD = `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')}`;
    const gradPathD = `M ${points[0].x} 125 L ${points.map(p => `${p.x} ${p.y}`).join(' L ')} L ${points[points.length - 1].x} 125 Z`;

    wrapper.innerHTML = `
      <svg class="chart-svg" viewBox="0 0 320 150">
        <defs>
          <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--text-primary)" stop-opacity="0.18"/>
            <stop offset="100%" stop-color="var(--text-primary)" stop-opacity="0.0"/>
          </linearGradient>
        </defs>
        
        <!-- Y-Axis line -->
        <line x1="30" y1="20" x2="30" y2="125" stroke="var(--border-color)" stroke-width="1"></line>
        <!-- X-Axis line -->
        <line x1="30" y1="125" x2="310" y2="125" stroke="var(--border-color)" stroke-width="1"></line>
        
        <!-- Grid lines -->
        ${gridLinesHTML}
        
        <!-- Gradient Area -->
        <path class="chart-line-gradient" d="${gradPathD}"></path>
        
        <!-- Line Path -->
        <path class="chart-line" d="${pathD}"></path>
        
        <!-- Nodes -->
        ${nodesHTML}
        
        <!-- Labels -->
        ${labelsHTML}
      </svg>
    `;
  }

  showChartTooltip(event, idx, cx, cy) {
    const tooltip = document.getElementById('chart-tooltip');
    if (!tooltip || !this.projectedSpendData) return;

    const data = this.projectedSpendData[idx];
    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const monthTitle = `${monthNames[data.month]} ${data.year}`;

    // Scan for events in this month
    const events = [];
    const activeSubs = this.subscriptions.filter(sub => {
      const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
      return matchesScope && !sub.isCancelled;
    });

    activeSubs.forEach(sub => {
      if (sub.isTrial && sub.trialEnd) {
        const trialEndDate = new Date(sub.trialEnd);
        if (trialEndDate.getMonth() === data.month && trialEndDate.getFullYear() === data.year) {
          events.push(`⏳ ${sub.name} Converts (+$${parseFloat(sub.price).toFixed(2)})`);
        }
      }
      if (sub.priceHike) {
        const hikeDate = new Date(sub.priceHike.date);
        if (hikeDate.getMonth() === data.month && hikeDate.getFullYear() === data.year) {
          const diff = sub.priceHike.newPrice - sub.priceHike.originalPrice;
          events.push(`📈 ${sub.name} Hike Active (+$${diff.toFixed(2)})`);
        }
      }
    });

    let eventsHTML = '';
    if (events.length > 0) {
      eventsHTML = `<div style="margin-top: 4px; font-weight: normal; color: var(--text-secondary); font-size: 8px; border-top: 1px solid #ccc; padding-top: 2px;">${events.join('<br>')}</div>`;
    }

    tooltip.innerHTML = `
      <div class="tooltip-month">${monthTitle}</div>
      <div>Projected Outflow: $${data.amount.toFixed(2)}</div>
      ${eventsHTML}
    `;

    tooltip.style.left = `${cx}px`;
    tooltip.style.top = `${cy - 45}px`;
    tooltip.style.display = 'block';
    tooltip.style.transform = 'translateX(-50%)';
  }

  hideChartTooltip() {
    const tooltip = document.getElementById('chart-tooltip');
    if (tooltip) {
      tooltip.style.display = 'none';
    }
  }

  renderSeatUsageAnalyzer() {
    const card = document.getElementById('seat-analyzer-card');
    if (!card) return;

    if (this.currentScope !== 'team') {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'block';

    let totalSeatsPurchased = 0;
    let totalSeatsAssigned = 0;
    let totalWaste = 0;

    const teamSubs = this.subscriptions.filter(sub => sub.isTeam && !sub.isCancelled);

    teamSubs.forEach(sub => {
      if (sub.seatsPurchased !== undefined) {
        totalSeatsPurchased += sub.seatsPurchased;
        totalSeatsAssigned += sub.seatsAssigned;
        const wasteSeats = sub.seatsPurchased - sub.seatsAssigned;
        if (wasteSeats > 0) {
          totalWaste += wasteSeats * sub.pricePerSeat;
        }
      }
    });

    document.getElementById('seats-purchased-val').innerText = totalSeatsPurchased;
    document.getElementById('seats-assigned-val').innerText = totalSeatsAssigned;
    document.getElementById('seats-waste-val').innerText = `$${totalWaste.toFixed(2)}`;

    const banner = document.getElementById('seat-waste-banner');
    if (banner) {
      if (totalWaste > 0) {
        banner.style.display = 'block';
        banner.innerHTML = `🚨 You are wasting <strong>$${totalWaste.toFixed(2)}/mo</strong> on unassigned seats. Adjust paid seat capacity below to optimize.`;
      } else {
        banner.style.display = 'none';
      }
    }

    const adjusterRow = document.getElementById('seat-adjuster-row');
    if (adjusterRow) {
      adjusterRow.innerHTML = '';
      teamSubs.forEach(sub => {
        if (sub.seatsPurchased !== undefined) {
          const item = document.createElement('div');
          item.className = 'seat-adjust-item';
          item.style.padding = '8px 0';
          item.style.borderBottom = '1px solid var(--border-color)';
          item.innerHTML = `
            <span class="seat-adjust-label" style="font-weight:700;">${sub.name} Seats</span>
            <div class="seat-slider-wrapper">
              <input type="range" class="seat-adjust-slider" min="${sub.seatsAssigned}" max="10" value="${sub.seatsPurchased}" oninput="app.updateSeats(${sub.id}, this.value)">
              <span class="seat-count-badge" style="font-size:11px; font-weight:700;">${sub.seatsPurchased} Paid / ${sub.seatsAssigned} Active</span>
            </div>
          `;
          adjusterRow.appendChild(item);
        }
      });
    }
  }

  updateSeats(subId, newSeatsVal) {
    const sub = this.subscriptions.find(s => s.id === subId);
    if (sub) {
      sub.seatsPurchased = parseInt(newSeatsVal);
      sub.price = sub.seatsPurchased * (sub.pricePerSeat || (sub.price / (sub.seatsPurchased || 1)));
      this.saveState();
      this.renderAll();
    }
  }

  renderWallet() {
    const list = document.getElementById('virtual-cards-list');
    const linkedList = document.getElementById('linked-subs-list');
    if (!list || !linkedList) return;

    list.innerHTML = '';

    const scopeCards = this.virtualCards.filter(c => c.scope === this.currentScope);

    if (scopeCards.length > 0) {
      const exists = scopeCards.some(c => c.id === this.selectedCardId);
      if (!exists) {
        this.selectedCardId = scopeCards[0].id;
      }
    } else {
      this.selectedCardId = null;
    }

    if (scopeCards.length === 0) {
      list.innerHTML = `<div class="text-center text-muted" style="width: 100%; padding: 20px 0; font-size: 11px;">No virtual cards created for ${this.currentScope} scope.</div>`;
    } else {
      scopeCards.forEach(card => {
        let totalSpent = 0;
        const activeSubs = this.subscriptions.filter(sub => {
          const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
          return matchesScope && !sub.isCancelled && sub.cardId === card.id;
        });

        activeSubs.forEach(sub => {
          const price = parseFloat(sub.price);
          if (sub.cycle === 'monthly') {
            totalSpent += price;
          } else {
            totalSpent += price / 12;
          }
        });

        const isOverLimit = totalSpent > card.limit;
        const pct = Math.min((totalSpent / card.limit) * 100, 100);

        const cardEl = document.createElement('div');
        cardEl.className = `virtual-card ${isOverLimit ? 'over-limit' : ''}`;
        if (card.id === this.selectedCardId) {
          cardEl.style.borderColor = 'var(--text-primary)';
          cardEl.style.boxShadow = '0 0 12px rgba(255,255,255,0.18)';
        }

        cardEl.onclick = () => this.selectVirtualCard(card.id);

        cardEl.innerHTML = `
          <div class="card-header-row">
            <span class="card-name">${this.escapeHtml(card.name)}</span>
            <span class="card-network">VISA</span>
          </div>
          <div class="card-middle">
            <div class="card-digits">${this.escapeHtml(card.digits)}</div>
            <div class="card-expiry">EXP ${this.escapeHtml(card.expiry)}</div>
          </div>
          <div class="card-bottom-row">
            <div class="card-limit-info">
              <span>Spent: $${totalSpent.toFixed(2)}</span>
              <span>Limit: $${card.limit.toFixed(0)}</span>
            </div>
            <div class="card-limit-progress-bar">
              <div class="card-limit-progress-fill ${isOverLimit ? 'exceeded' : ''}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
        list.appendChild(cardEl);
      });
    }

    linkedList.innerHTML = '';
    if (!this.selectedCardId) {
      linkedList.innerHTML = `<div class="text-center text-muted" style="padding: 10px 0; font-size:11px;">Select a card above to view linked transactions.</div>`;
    } else {
      const activeSubs = this.subscriptions.filter(sub => {
        const matchesScope = this.currentScope === 'team' ? sub.isTeam : !sub.isTeam;
        return matchesScope && !sub.isCancelled && sub.cardId === this.selectedCardId;
      });

      if (activeSubs.length === 0) {
        linkedList.innerHTML = `<div class="text-center text-muted" style="padding: 10px 0; font-size:11px;">No active subscriptions linked to this card.</div>`;
      } else {
        activeSubs.forEach(sub => {
          const item = document.createElement('div');
          item.className = 'wallet-linked-item';
          item.style.padding = '8px 0';
          item.style.borderBottom = '1px solid var(--border-color)';
          item.style.display = 'flex';
          item.style.justifyContent = 'space-between';
          item.style.alignItems = 'center';

          const cardOptions = this.virtualCards
            .filter(c => c.scope === this.currentScope)
            .map(c => `<option value="${c.id}" ${c.id === sub.cardId ? 'selected' : ''}>${this.escapeHtml(c.name)}</option>`)
            .join('');

          item.innerHTML = `
            <div style="display:flex; align-items:center; gap: 8px;">
              <div class="sub-logo" style="width: 24px; height: 24px; font-size: 10px; line-height: 24px;">${this.escapeHtml(sub.name.charAt(0))}</div>
              <div>
                <div class="wallet-linked-name" style="font-size: 12px; font-weight:700; color:var(--text-primary);">${this.escapeHtml(sub.name)}</div>
                <div style="font-size: 9px; color: var(--text-tertiary);">Next renewal: ${this.formatDate(sub.nextRenewal)}</div>
              </div>
            </div>
            <div style="text-align:right;">
              <div class="wallet-linked-price" style="font-size:12px; font-weight:700; color:var(--text-primary);">$${parseFloat(sub.price).toFixed(2)}${sub.cycle === 'monthly' ? '/mo' : '/yr'}</div>
              <select style="font-size: 9px; padding: 2px 4px; border-radius: 4px; background-color: var(--bg-input); border: 1px solid var(--border-color); color: var(--text-primary); margin-top:4px;" onchange="app.reassignSubCard(${sub.id}, this.value)">
                ${cardOptions}
              </select>
            </div>
          `;
          linkedList.appendChild(item);
        });
      }
    }
  }

  handleCreateVirtualCard(event) {
    event.preventDefault();
    const name = document.getElementById('card-new-name').value.trim();
    const limit = parseFloat(document.getElementById('card-new-limit').value);

    if (!name) {
      alert('Card name is required.');
      return;
    }

    const newCard = {
      id: 'c' + Date.now(),
      name: name,
      digits: '•••• •••• •••• ' + Math.floor(1000 + Math.random() * 9000),
      expiry: '06/31',
      limit: limit,
      scope: this.currentScope
    };

    this.virtualCards.push(newCard);
    this.saveState();
    this.selectedCardId = newCard.id;

    event.target.reset();
    this.renderAll();
    this.showToast('💳 Card Generated', `New virtual card "${name}" created with $${limit} limit.`);
  }

  reassignSubCard(subId, newCardId) {
    const sub = this.subscriptions.find(s => s.id === subId);
    if (sub) {
      sub.cardId = newCardId;
      this.saveState();
      this.renderAll();
      this.showToast('💳 Card Linked', `Assigned ${sub.name} to card.`);
    }
  }

  selectVirtualCard(cardId) {
    this.selectedCardId = cardId;
    this.renderWallet();
  }

  updateCardDropdown() {
    const select = document.getElementById('sub-card-binding');
    if (!select) return;
    select.innerHTML = '';
    const scopeCards = this.virtualCards.filter(c => c.scope === this.currentScope);
    scopeCards.forEach(card => {
      const opt = document.createElement('option');
      opt.value = card.id;
      opt.innerText = `${card.name} (${card.digits.slice(-4)})`;
      select.appendChild(opt);
    });
  }

  applyLayoutMode() {
    const frame = document.querySelector('.phone-frame');
    const toggleBtn = document.getElementById('toggle-layout-btn');
    const svgIcon = document.getElementById('layout-icon-svg');

    if (!frame) return;

    if (this.layoutMode === 'desktop') {
      frame.classList.add('desktop-mode');
      if (toggleBtn) toggleBtn.title = "Switch to Mobile Frame Preview";
      if (svgIcon) {
        // Render Mobile Phone SVG icon inside button
        svgIcon.innerHTML = `
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
          <line x1="12" y1="18" x2="12.01" y2="18"/>
        `;
      }
    } else {
      frame.classList.remove('desktop-mode');
      if (toggleBtn) toggleBtn.title = "Switch to Widescreen Desktop Mode";
      if (svgIcon) {
        // Render Desktop Monitor SVG icon inside button
        svgIcon.innerHTML = `
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
          <line x1="8" y1="21" x2="16" y2="21"/>
          <line x1="12" y1="17" x2="12" y2="21"/>
        `;
      }
    }
    
    // Refresh canvas and SVG layouts since sizes might have shifted
    setTimeout(() => {
      this.renderSpendTrendChart();
    }, 150);
  }

  toggleLayoutMode() {
    this.layoutMode = this.layoutMode === 'desktop' ? 'mobile' : 'desktop';
    localStorage.setItem('subscript_layout_mode', this.layoutMode);
    this.applyLayoutMode();
    this.showToast(
      this.layoutMode === 'desktop' ? '🖥️ Desktop View' : '📱 Mobile Preview',
      `Switched to ${this.layoutMode} layout mode successfully.`
    );
  }
}

// Instantiate App on window load
let app;
window.addEventListener('DOMContentLoaded', () => {
  app = new SubscriptApp();
  
  // Expose global callback hooks for custom triggers in HTML
  window.app = app;
});
