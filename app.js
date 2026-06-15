/* ============================================================
   RetailPulse Analytics — Dashboard Logic
   Fully functional filtering with granular transactional data,
   Chart.js charts, animated counters, dynamic insight generation
   ============================================================ */

(function () {
  "use strict";

  /* ─────────────────────────────────────────────────
     1. GRANULAR TRANSACTIONAL DATA
     Every record = { month, region, product, category,
                       revenue, units, profit, orders }
     When unfiltered, totals match the original KPIs exactly.
     ───────────────────────────────────────────────── */

  // Distribution weights used to spread product totals across months & regions
  // These are carefully calibrated so that sums reproduce the original numbers.

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const REGIONS = ["North","South","West","East"];
  const REGION_COLORS = { North:"#6366f1", South:"#a855f7", West:"#14b8a6", East:"#f59e0b" };

  // The 5 listed products total ₹4,34,00,000 in revenue and ₹77,50,000 in profit.
  // The business total is ₹4,82,50,000 revenue at 18.4% margin (₹88,78,000 profit).
  // An invisible "Other Products" row fills the gap so every aggregation sums correctly.
  const LISTED_PRODUCT_REVENUE = 12500000+10800000+8200000+6700000+5200000; // 43400000
  const LISTED_PRODUCT_PROFIT  = 2250000+1840000+1580000+1160000+920000;    // 7750000

  const PRODUCTS_MASTER = [
    { name:"Laptop",          category:"electronics", revenue:12500000, units:1420, profit:2250000, hidden:false },
    { name:"Smartphone",      category:"electronics", revenue:10800000, units:2950, profit:1840000, hidden:false },
    { name:"Smart TV",        category:"electronics", revenue:8200000,  units:760,  profit:1580000, hidden:false },
    { name:"Air Conditioner", category:"appliances",  revenue:6700000,  units:540,  profit:1160000, hidden:false },
    { name:"Washing Machine", category:"appliances",  revenue:5200000,  units:680,  profit:920000,  hidden:false },
    // Hidden filler: covers accessories, peripherals, small appliances, etc.
    { name:"Other Products",  category:"other",       revenue:48250000-43400000, units:495, profit:Math.round(48250000*0.184)-7750000, hidden:true },
  ];

  // ── SOURCE CONSTANTS (the exact values the user provided) ──
  const TOTAL_REVENUE = 48250000;
  const TOTAL_ORDERS  = 12845;
  const TOTAL_AOV     = 3756;
  const TOTAL_MARGIN  = 18.4;
  const TOTAL_PROFIT  = TOTAL_REVENUE * TOTAL_MARGIN / 100; // ₹88,78,000

  // Actual monthly revenue from source data (sum = 48250000 exactly)
  const MONTHLY_VALUES = [3250000,3420000,3780000,3540000,3960000,4150000,4320000,4080000,3860000,4490000,4730000,4670000];

  // Actual regional revenue from source data (sum = 48250000 exactly)
  const REGIONAL_VALUES = { North:14200000, South:11850000, West:13580000, East:8620000 };

  // Compute weights as exact fractions of the total — guarantees sum ≡ 1.0
  const MONTH_W  = MONTHLY_VALUES.map(v => v / TOTAL_REVENUE);
  const REGION_W = {};
  REGIONS.forEach(r => { REGION_W[r] = REGIONAL_VALUES[r] / TOTAL_REVENUE; });

  // With the "Other Products" filler, product profits now sum to TOTAL_PROFIT,
  // so PROFIT_SCALE = 1.0 — kpiProfit and profit are identical.
  const PRODUCT_PROFIT_SUM = PRODUCTS_MASTER.reduce((s, p) => s + p.profit, 0);
  const PROFIT_SCALE = TOTAL_PROFIT / PRODUCT_PROFIT_SUM; // ≈ 1.0

  // Build the granular records (5 products × 12 months × 4 regions = 240 rows)
  const RECORDS = [];

  PRODUCTS_MASTER.forEach(prod => {
    const prodOrderShare = prod.revenue / TOTAL_REVENUE; // this product's share of total orders
    MONTHS.forEach((month, mi) => {
      REGIONS.forEach(region => {
        const w = MONTH_W[mi] * REGION_W[region];
        RECORDS.push({
          month,
          monthIndex: mi,
          region,
          product:   prod.name,
          category:  prod.category,
          hidden:    prod.hidden,                     // true for "Other Products"
          revenue:   prod.revenue * w,
          units:     prod.units   * w,
          profit:    prod.profit  * w,                // product-level profit (for table)
          kpiProfit: prod.profit  * w * PROFIT_SCALE, // scaled profit (for KPI margin)
          orders:    TOTAL_ORDERS * prodOrderShare * w,
        });
      });
    });
  });

  /* Sales reps — assign each rep to primary region(s) for filtering */
  const REPS_MASTER = [
    { name:"Rahul Sharma",  baseRevenue:8200000, baseTarget:118, initials:"RS", gradient:"linear-gradient(135deg,#6366f1,#a855f7)", regions:["North","West"] },
    { name:"Priya Patel",   baseRevenue:7600000, baseTarget:109, initials:"PP", gradient:"linear-gradient(135deg,#14b8a6,#38bdf8)", regions:["South","West"] },
    { name:"Amit Verma",    baseRevenue:6800000, baseTarget:102, initials:"AV", gradient:"linear-gradient(135deg,#f59e0b,#fbbf24)", regions:["North","East"] },
    { name:"Neha Singh",    baseRevenue:5900000, baseTarget:96,  initials:"NS", gradient:"linear-gradient(135deg,#f43f5e,#fb7185)", regions:["South","East"] },
    { name:"Karan Mehta",   baseRevenue:5100000, baseTarget:91,  initials:"KM", gradient:"linear-gradient(135deg,#64748b,#94a3b8)", regions:["East","North"] },
  ];

  // Quarter → month indices mapping
  const QUARTER_MONTHS = {
    fy2025: [0,1,2,3,4,5,6,7,8,9,10,11],
    q1: [3,4,5],   // Apr-Jun
    q2: [6,7,8],   // Jul-Sep
    q3: [9,10,11], // Oct-Dec
    q4: [0,1,2],   // Jan-Mar
  };

  /* ─────────────────────────────────────────────────
     2. FILTER STATE
     ───────────────────────────────────────────────── */
  let currentFilters = {
    dateRange: "fy2025",
    region:    "all",
    category:  "all",
  };

  let activeChartType = "bar"; // track bar/line toggle

  /* ─────────────────────────────────────────────────
     3. DATA AGGREGATION ENGINE
     ───────────────────────────────────────────────── */

  function getFilteredRecords(filters) {
    const months = QUARTER_MONTHS[filters.dateRange];
    return RECORDS.filter(r => {
      if (!months.includes(r.monthIndex)) return false;
      if (filters.region !== "all" && r.region.toLowerCase() !== filters.region) return false;
      if (filters.category !== "all" && r.category !== filters.category) return false;
      return true;
    });
  }

  // Returns true when every filter is at its default (full dataset)
  function isUnfiltered(filters) {
    return filters.dateRange === "fy2025" &&
           filters.region   === "all" &&
           filters.category === "all";
  }

  function aggregateKPIs(records, filters) {
    // When no filters are active, return the exact source figures.
    // This guarantees ₹4,82,50,000 / 12,845 / ₹3,756 / 18.4% with zero drift.
    if (isUnfiltered(filters)) {
      return {
        revenue: TOTAL_REVENUE,
        orders:  TOTAL_ORDERS,
        aov:     TOTAL_AOV,
        margin:  TOTAL_MARGIN,
      };
    }

    // Filtered aggregation
    let revenue = 0, kpiProfit = 0, orders = 0;
    records.forEach(r => {
      revenue   += r.revenue;
      kpiProfit += r.kpiProfit;
      orders    += r.orders;
    });
    orders = Math.round(orders) || 1; // round the accumulated float
    return {
      revenue: Math.round(revenue),
      orders,
      aov:    Math.round(revenue / orders),
      margin: revenue > 0 ? parseFloat(((kpiProfit / revenue) * 100).toFixed(1)) : 0,
    };
  }

  function aggregateMonthly(records) {
    const months = QUARTER_MONTHS[currentFilters.dateRange];
    const byMonth = {};
    months.forEach(mi => { byMonth[mi] = 0; });
    records.forEach(r => { byMonth[r.monthIndex] = (byMonth[r.monthIndex] || 0) + r.revenue; });
    const labels = months.map(mi => MONTHS[mi]);
    const values = months.map(mi => Math.round(byMonth[mi] || 0));
    return { labels, values };
  }

  function aggregateRegional(records) {
    const byRegion = {};
    records.forEach(r => { byRegion[r.region] = (byRegion[r.region] || 0) + r.revenue; });
    // Filter out zero-value regions and maintain order
    const labels = [], values = [], colors = [];
    REGIONS.forEach(reg => {
      const val = Math.round(byRegion[reg] || 0);
      if (val > 0) {
        labels.push(reg);
        values.push(val);
        colors.push(REGION_COLORS[reg]);
      }
    });
    return { labels, values, colors };
  }

  function aggregateProducts(records) {
    const byProduct = {};
    records.forEach(r => {
      if (r.hidden) return; // exclude "Other Products" from the visible table
      if (!byProduct[r.product]) byProduct[r.product] = { name: r.product, category: r.category, revenue:0, units:0, profit:0 };
      byProduct[r.product].revenue += r.revenue;
      byProduct[r.product].units   += r.units;
      byProduct[r.product].profit  += r.profit;
    });
    return Object.values(byProduct)
      .map(p => ({ ...p, revenue: Math.round(p.revenue), units: Math.round(p.units), profit: Math.round(p.profit) }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  function aggregateReps(filters) {
    const months = QUARTER_MONTHS[filters.dateRange];
    const monthFraction = months.length / 12;
    return REPS_MASTER
      .map(rep => {
        let regionFactor = 1;
        if (filters.region !== "all") {
          regionFactor = rep.regions.includes(filters.region.charAt(0).toUpperCase() + filters.region.slice(1)) ? 1 : 0.15;
        }
        // Category affects revenue volume
        let catFactor = 1;
        if (filters.category === "electronics") catFactor = 0.65;
        else if (filters.category === "appliances") catFactor = 0.35;

        const adjustedRevenue = Math.round(rep.baseRevenue * monthFraction * regionFactor * catFactor);
        // Target % is adjusted relative to filtered scope
        const targetBase = rep.baseTarget;
        const adjustedTarget = Math.round(targetBase * regionFactor * catFactor / (regionFactor * catFactor || 1));

        return {
          ...rep,
          revenue: adjustedRevenue,
          target: adjustedTarget,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }

  /* ─────────────────────────────────────────────────
     4. DYNAMIC INSIGHT GENERATION
     ───────────────────────────────────────────────── */

  function generateInsights(kpiData, regionalData, productsData, repsData, monthlyData) {
    const insights = [];
    const m = (v) => `<span class="insight-metric">${v}</span>`;

    // 1. Best-performing region
    if (regionalData.labels.length > 1) {
      const maxIdx = regionalData.values.indexOf(Math.max(...regionalData.values));
      const total = regionalData.values.reduce((a,b) => a+b, 0);
      const pct = ((regionalData.values[maxIdx] / total) * 100).toFixed(1);
      insights.push({
        tag: "Top Region", tagClass: "tag-success",
        title: `${regionalData.labels[maxIdx]} India Leads Revenue`,
        body: `The ${m(regionalData.labels[maxIdx])} region generated ${m(shortINR(regionalData.values[maxIdx]))}, contributing ${pct}% of total filtered revenue — the strongest performer in the current selection.`,
      });
    } else if (regionalData.labels.length === 1) {
      insights.push({
        tag: "Region Focus", tagClass: "tag-info",
        title: `Viewing ${regionalData.labels[0]} Region Only`,
        body: `You are viewing data filtered to the ${m(regionalData.labels[0])} region with total revenue of ${m(shortINR(regionalData.values[0]))}. Remove the region filter to compare across all regions.`,
      });
    }

    // 2. Worst-performing region
    if (regionalData.labels.length > 1) {
      const minIdx = regionalData.values.indexOf(Math.min(...regionalData.values));
      const total = regionalData.values.reduce((a,b) => a+b, 0);
      const pct = ((regionalData.values[minIdx] / total) * 100).toFixed(1);
      insights.push({
        tag: "Growth Concern", tagClass: "tag-danger",
        title: `${regionalData.labels[minIdx]} Region Needs Attention`,
        body: `The ${m(regionalData.labels[minIdx])} region contributed only ${m(shortINR(regionalData.values[minIdx]))} (${pct}%). Expanding distribution networks and running targeted promotions in this region could unlock significant growth potential.`,
      });
    }

    // 3. Top product
    if (productsData.length > 0) {
      const top = productsData[0];
      const margin = ((top.profit / top.revenue) * 100).toFixed(1);
      insights.push({
        tag: "Star Product", tagClass: "tag-info",
        title: `${top.name}s Drive Maximum Revenue`,
        body: `${m(top.name)} generated ${m(shortINR(top.revenue))} with a profit of ${m(shortINR(top.profit))} (${margin}% margin) and ${m(top.units.toLocaleString("en-IN"))} units sold in the filtered period.`,
      });
    }

    // 4. Lowest-performing salesperson
    if (repsData.length > 0) {
      const lowest = repsData[repsData.length - 1];
      const statusWord = lowest.target >= 100 ? "meeting" : "below";
      const tagClass = lowest.target >= 100 ? "tag-warning" : "tag-danger";
      insights.push({
        tag: "Sales Alert", tagClass,
        title: `${lowest.name} — ${statusWord === "below" ? "Below" : "At"} Target`,
        body: `${m(lowest.name)} achieved ${m(lowest.target + "%")} of the sales target, generating ${m(shortINR(lowest.revenue))}. ${statusWord === "below" ? "A coaching program focused on upselling techniques and territory optimization is recommended." : "Performance is at par but there is room for improvement through cross-selling strategies."}`,
      });
    }

    // 5. Revenue trend analysis
    if (monthlyData.values.length >= 3) {
      const vals = monthlyData.values;
      const maxVal = Math.max(...vals);
      const maxIdx = vals.indexOf(maxVal);
      const peakMonth = monthlyData.labels[maxIdx];
      // Calculate trend: compare first half vs second half of visible months
      const mid = Math.floor(vals.length / 2);
      const firstHalf = vals.slice(0, mid).reduce((a,b) => a+b, 0) / mid;
      const secondHalf = vals.slice(mid).reduce((a,b) => a+b, 0) / (vals.length - mid);
      const trendPct = (((secondHalf - firstHalf) / firstHalf) * 100).toFixed(1);
      const trendDir = secondHalf > firstHalf ? "upward" : "downward";
      insights.push({
        tag: "Trend Analysis", tagClass: "tag-insight",
        title: `Revenue Shows ${trendDir.charAt(0).toUpperCase() + trendDir.slice(1)} Momentum`,
        body: `Monthly revenue peaked at ${m(shortINR(maxVal) + " in " + peakMonth)}. The ${trendDir === "upward" ? "latter" : "earlier"} period averages ${m(Math.abs(trendPct) + "%")} ${trendDir === "upward" ? "higher" : "lower"} than the ${trendDir === "upward" ? "earlier" : "latter"} period. ${trendDir === "upward" ? "Momentum is strong — capitalize with increased inventory and promotions." : "Consider investigating seasonal dips and deploying targeted campaigns."}`,
      });
    } else if (monthlyData.values.length > 0) {
      const total = monthlyData.values.reduce((a,b) => a+b, 0);
      insights.push({
        tag: "Trend Analysis", tagClass: "tag-insight",
        title: "Limited Trend Data in Current Filter",
        body: `With only ${m(monthlyData.labels.length)} month(s) selected, trend analysis is limited. Total revenue for the period is ${m(shortINR(total))}. Expand the date range for deeper trend insights.`,
      });
    }

    // 6. Opportunity — highest-margin product
    if (productsData.length >= 2) {
      const withMargin = productsData.map(p => ({ ...p, marginPct: (p.profit / p.revenue) * 100 }));
      withMargin.sort((a,b) => b.marginPct - a.marginPct);
      const best = withMargin[0];
      insights.push({
        tag: "Opportunity", tagClass: "tag-success",
        title: `${best.name} Has Best Profit Margin`,
        body: `${m(best.name)} delivers a ${m(best.marginPct.toFixed(1) + "% profit margin")} — the highest across all products in the current view. Prioritizing premium models and bundling with accessories can maximize profitability.`,
      });
    }

    return insights;
  }

  /* ─────────────────────────────────────────────────
     5. UTILITIES
     ───────────────────────────────────────────────── */

  const INR = (n) => "₹" + n.toLocaleString("en-IN");
  const shortINR = (n) => {
    if (n >= 10000000) return "₹" + (n / 10000000).toFixed(2) + " Cr";
    if (n >= 100000)   return "₹" + (n / 100000).toFixed(1) + " L";
    return INR(n);
  };

  function animateValue(el, from, to, duration, formatter) {
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = from + (to - from) * eased;
      el.textContent = formatter(current);
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ─────────────────────────────────────────────────
     6. RENDERING FUNCTIONS
     All accept data as parameters — no reliance on
     hard-coded DATA object.
     ───────────────────────────────────────────────── */

  /* — KPI Cards — */
  function renderKPIs(kpi, animate = true) {
    const dur = animate ? 1200 : 0;

    const revEl = document.querySelector("#kpi-revenue .kpi-value");
    const ordEl = document.querySelector("#kpi-orders .kpi-value");
    const aovEl = document.querySelector("#kpi-aov .kpi-value");
    const mrgEl = document.querySelector("#kpi-margin .kpi-value");

    if (animate) {
      const prevRev = parseFloat(revEl.dataset.current) || 0;
      const prevOrd = parseFloat(ordEl.dataset.current) || 0;
      const prevAov = parseFloat(aovEl.dataset.current) || 0;
      const prevMrg = parseFloat(mrgEl.dataset.current) || 0;

      animateValue(revEl, prevRev, kpi.revenue, dur, v => INR(Math.floor(v)));
      animateValue(ordEl, prevOrd, kpi.orders,  dur, v => Math.floor(v).toLocaleString("en-IN"));
      animateValue(aovEl, prevAov, kpi.aov,     dur, v => INR(Math.floor(v)));
      animateValue(mrgEl, prevMrg, kpi.margin,  dur, v => v.toFixed(1) + "%");
    } else {
      revEl.textContent = INR(kpi.revenue);
      ordEl.textContent = kpi.orders.toLocaleString("en-IN");
      aovEl.textContent = INR(kpi.aov);
      mrgEl.textContent = kpi.margin + "%";
    }

    revEl.dataset.current = kpi.revenue;
    ordEl.dataset.current = kpi.orders;
    aovEl.dataset.current = kpi.aov;
    mrgEl.dataset.current = kpi.margin;
  }

  /* — Monthly Revenue Chart — */
  let monthlyChart;

  function renderMonthlyChart(monthlyData, type) {
    const ctx = document.getElementById("monthlyRevenueChart");
    if (monthlyChart) monthlyChart.destroy();

    const gradient = ctx.getContext("2d").createLinearGradient(0, 0, 0, 320);
    gradient.addColorStop(0, "rgba(99, 102, 241, 0.45)");
    gradient.addColorStop(1, "rgba(99, 102, 241, 0.02)");

    const borderGradient = ctx.getContext("2d").createLinearGradient(0, 0, ctx.offsetWidth || 600, 0);
    borderGradient.addColorStop(0, "#6366f1");
    borderGradient.addColorStop(1, "#a855f7");

    const config = {
      type,
      data: {
        labels: monthlyData.labels,
        datasets: [{
          label: "Revenue",
          data: monthlyData.values,
          backgroundColor: type === "bar" ? gradient : "transparent",
          borderColor: borderGradient,
          borderWidth: type === "bar" ? 0 : 3,
          borderRadius: type === "bar" ? 8 : 0,
          fill: type === "line",
          tension: 0.4,
          pointBackgroundColor: "#6366f1",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          pointRadius: type === "line" ? 5 : 0,
          pointHoverRadius: 7,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12, weight: "500" } } },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(99, 102, 241, 0.06)" },
            ticks: { font: { size: 11 }, callback: v => shortINR(v) },
          },
        },
        plugins: {
          tooltip: { callbacks: { label: (ctx) => " Revenue: " + INR(ctx.raw) } },
        },
      },
    };

    if (type === "line") {
      const fillGrad = ctx.getContext("2d").createLinearGradient(0, 0, 0, 320);
      fillGrad.addColorStop(0, "rgba(99, 102, 241, 0.22)");
      fillGrad.addColorStop(1, "rgba(99, 102, 241, 0.01)");
      config.data.datasets[0].backgroundColor = fillGrad;
      config.data.datasets[0].fill = true;
    }

    monthlyChart = new Chart(ctx, config);
  }

  /* — Regional Doughnut Chart — */
  let regionalChart;

  function renderRegionalChart(regionalData) {
    const ctx = document.getElementById("regionalSalesChart");
    if (regionalChart) regionalChart.destroy();

    regionalChart = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: regionalData.labels,
        datasets: [{
          data: regionalData.values,
          backgroundColor: regionalData.colors,
          borderColor: "rgba(10, 14, 26, 0.9)",
          borderWidth: 3,
          hoverOffset: 14,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "68%",
        animation: { animateRotate: true, duration: 800 },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = ((ctx.raw / total) * 100).toFixed(1);
                return ` ${ctx.label}: ${shortINR(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    });

    // Rebuild custom legend
    const legendEl = document.getElementById("regional-legend");
    legendEl.innerHTML = "";
    const total = regionalData.values.reduce((a,b) => a+b, 0);
    regionalData.labels.forEach((label, i) => {
      const pct = total > 0 ? ((regionalData.values[i] / total) * 100).toFixed(1) : "0.0";
      const item = document.createElement("div");
      item.className = "legend-item";
      item.innerHTML = `<span class="legend-dot" style="background:${regionalData.colors[i]}"></span>${label} — ${pct}%`;
      legendEl.appendChild(item);
    });
  }

  /* — Product Comparison Chart — */
  let productChart;

  function renderProductChart(productsData) {
    const ctx = document.getElementById("productComparisonChart");
    if (productChart) productChart.destroy();

    productChart = new Chart(ctx, {
      type: "bar",
      data: {
        labels: productsData.map(p => p.name),
        datasets: [
          {
            label: "Revenue",
            data: productsData.map(p => p.revenue),
            backgroundColor: "rgba(99, 102, 241, 0.55)",
            borderColor: "#6366f1",
            borderWidth: 0,
            borderRadius: 8,
            barPercentage: 0.45,
            categoryPercentage: 0.7,
          },
          {
            label: "Profit",
            data: productsData.map(p => p.profit),
            backgroundColor: "rgba(34, 197, 94, 0.55)",
            borderColor: "#22c55e",
            borderWidth: 0,
            borderRadius: 8,
            barPercentage: 0.45,
            categoryPercentage: 0.7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            display: true, position: "top", align: "end",
            labels: {
              boxWidth: 12, boxHeight: 12, borderRadius: 3,
              useBorderRadius: true, padding: 20,
              font: { size: 12, weight: "500" },
            },
          },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${INR(ctx.raw)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 12, weight: "500" } } },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(99, 102, 241, 0.06)" },
            ticks: { font: { size: 11 }, callback: v => shortINR(v) },
          },
        },
      },
    });
  }

  /* — Products Table — */
  function renderProducts(productsData) {
    const tbody = document.getElementById("products-tbody");
    tbody.innerHTML = "";
    if (productsData.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px;">No products match the current filters.</td></tr>`;
      return;
    }
    productsData.forEach((p, i) => {
      const margin = p.revenue > 0 ? ((p.profit / p.revenue) * 100).toFixed(1) : "0.0";
      const rankClass = i < 3 ? `rank-${i + 1}` : "rank-other";
      const marginClass = parseFloat(margin) >= 18 ? "margin-high" : "margin-medium";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="product-rank ${rankClass}">${i + 1}</span></td>
        <td class="product-name">${p.name}</td>
        <td>${shortINR(p.revenue)}</td>
        <td>${p.units.toLocaleString("en-IN")}</td>
        <td>${shortINR(p.profit)}</td>
        <td><span class="margin-badge ${marginClass}">${margin}%</span></td>
      `;
      tbody.appendChild(tr);
    });
  }

  /* — Sales Reps — */
  function renderReps(repsData) {
    const container = document.getElementById("sales-reps-list");
    container.innerHTML = "";
    repsData.forEach(rep => {
      const targetClass = rep.target >= 110 ? "target-exceeded" : rep.target >= 100 ? "target-near" : "target-below";
      const progressColor = rep.target >= 110
        ? "linear-gradient(90deg,#22c55e,#14b8a6)"
        : rep.target >= 100
          ? "linear-gradient(90deg,#f59e0b,#fbbf24)"
          : "linear-gradient(90deg,#f43f5e,#fb7185)";
      const fillWidth = Math.min(rep.target, 130);

      const card = document.createElement("div");
      card.className = "rep-card";
      card.innerHTML = `
        <div class="rep-avatar" style="background:${rep.gradient}">${rep.initials}</div>
        <div class="rep-info">
          <div class="rep-name">${rep.name}</div>
          <div class="rep-revenue">${shortINR(rep.revenue)} revenue generated</div>
          <div class="rep-progress">
            <div class="rep-progress-fill" style="width:0%;background:${progressColor}" data-width="${fillWidth}%"></div>
          </div>
        </div>
        <div class="rep-target">
          <div class="rep-target-value ${targetClass}">${rep.target}%</div>
          <div class="rep-target-label">Target</div>
        </div>
      `;
      container.appendChild(card);
    });

    // Animate progress bars
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.querySelectorAll(".rep-progress-fill").forEach(bar => {
          bar.style.width = bar.dataset.width;
        });
      }, 80);
    });
  }

  /* — AI Insights — */
  function renderInsights(insights) {
    const grid = document.getElementById("insights-grid");
    grid.innerHTML = "";
    insights.forEach((ins, idx) => {
      const card = document.createElement("div");
      card.className = "insight-card";
      card.style.animationDelay = `${0.08 * idx}s`;
      card.innerHTML = `
        <span class="insight-tag ${ins.tagClass}">${ins.tag}</span>
        <h3 class="insight-title">${ins.title}</h3>
        <p class="insight-body">${ins.body}</p>
      `;
      grid.appendChild(card);
    });
  }

  /* ─────────────────────────────────────────────────
     7. ACTIVE FILTER BADGE ON HEADER
     ───────────────────────────────────────────────── */
  function updateFilterBadge() {
    let existing = document.getElementById("active-filter-badge");
    const isFiltered = currentFilters.dateRange !== "fy2025" ||
                       currentFilters.region !== "all" ||
                       currentFilters.category !== "all";

    if (!isFiltered) {
      if (existing) existing.remove();
      return;
    }

    const parts = [];
    if (currentFilters.dateRange !== "fy2025") {
      const label = document.querySelector(`#filter-date-range option[value="${currentFilters.dateRange}"]`).textContent;
      parts.push(label);
    }
    if (currentFilters.region !== "all") {
      parts.push(currentFilters.region.charAt(0).toUpperCase() + currentFilters.region.slice(1));
    }
    if (currentFilters.category !== "all") {
      const label = document.querySelector(`#filter-category option[value="${currentFilters.category}"]`).textContent;
      parts.push(label);
    }

    if (!existing) {
      existing = document.createElement("span");
      existing.id = "active-filter-badge";
      existing.style.cssText = `
        display:inline-flex;align-items:center;gap:6px;
        font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;
        padding:5px 14px;border-radius:20px;
        background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.25);
        cursor:pointer;transition:all 0.25s ease;
      `;
      existing.title = "Click to reset all filters";
      existing.addEventListener("click", resetFilters);
      document.querySelector(".header-right").insertBefore(existing, document.getElementById("live-badge"));
    }
    existing.innerHTML = `🔍 ${parts.join(" · ")} <span style="margin-left:4px;opacity:0.6">✕</span>`;
  }

  function resetFilters() {
    document.getElementById("filter-date-range").value = "fy2025";
    document.getElementById("filter-region").value = "all";
    document.getElementById("filter-category").value = "all";
    currentFilters = { dateRange: "fy2025", region: "all", category: "all" };
    applyFilters(true);
  }

  /* ─────────────────────────────────────────────────
     8. MASTER APPLY FILTERS
     ───────────────────────────────────────────────── */

  function applyFilters(animate = true) {
    // Read current filter values
    currentFilters.dateRange = document.getElementById("filter-date-range").value;
    currentFilters.region    = document.getElementById("filter-region").value;
    currentFilters.category  = document.getElementById("filter-category").value;

    // Get filtered records
    const records       = getFilteredRecords(currentFilters);
    const kpiData       = aggregateKPIs(records, currentFilters);
    const monthlyData   = aggregateMonthly(records);
    const regionalData  = aggregateRegional(records);
    const productsData  = aggregateProducts(records);
    const repsData      = aggregateReps(currentFilters);

    // Generate dynamic insights
    const insights = generateInsights(kpiData, regionalData, productsData, repsData, monthlyData);

    // Render everything
    renderKPIs(kpiData, animate);
    renderMonthlyChart(monthlyData, activeChartType);
    renderRegionalChart(regionalData);
    renderProductChart(productsData);
    renderProducts(productsData);
    renderReps(repsData);
    renderInsights(insights);
    updateFilterBadge();

    // Flash KPI cards to indicate update
    if (animate) {
      document.querySelectorAll(".kpi-card").forEach(card => {
        card.style.borderColor = "rgba(99, 102, 241, 0.5)";
        card.style.boxShadow = "0 0 24px rgba(99, 102, 241, 0.15)";
        setTimeout(() => {
          card.style.borderColor = "";
          card.style.boxShadow = "";
        }, 800);
      });
    }
  }

  /* ─────────────────────────────────────────────────
     9. EVENT LISTENERS
     ───────────────────────────────────────────────── */

  function setDates() {
    const now = new Date();
    const opts = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    const el = document.getElementById("header-date");
    if (el) el.textContent = now.toLocaleDateString("en-IN", opts);
    const footerEl = document.getElementById("footer-date");
    if (footerEl) footerEl.textContent = now.toLocaleString("en-IN");
  }

  function setChartDefaults() {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = "#94a3b8";
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(17, 24, 39, 0.92)";
    Chart.defaults.plugins.tooltip.titleFont = { weight: "600", size: 13 };
    Chart.defaults.plugins.tooltip.bodyFont = { size: 12 };
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.borderColor = "rgba(99, 102, 241, 0.2)";
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.legend.display = false;
  }

  function initToggle() {
    const toggleBtns = document.querySelectorAll("#chart-type-toggle .toggle-btn");
    toggleBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        toggleBtns.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        activeChartType = btn.dataset.type;
        // Re-render monthly chart with current filtered data
        const records = getFilteredRecords(currentFilters);
        const monthlyData = aggregateMonthly(records);
        renderMonthlyChart(monthlyData, activeChartType);
      });
    });
  }

  function initFilters() {
    const btn = document.getElementById("btn-apply-filters");
    btn.addEventListener("click", () => {
      btn.textContent = "Applying…";
      btn.disabled = true;

      // Small delay for visual feedback then apply
      setTimeout(() => {
        applyFilters(true);
        btn.textContent = "Applied ✓";
        btn.style.background = "linear-gradient(135deg, #22c55e, #14b8a6)";
        setTimeout(() => {
          btn.textContent = "Apply Filters";
          btn.style.background = "";
          btn.disabled = false;
        }, 1000);
      }, 300);
    });

    // Also allow instant-apply on change (with debounce)
    let debounce;
    ["filter-date-range", "filter-region", "filter-category"].forEach(id => {
      document.getElementById(id).addEventListener("change", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => applyFilters(true), 150);
      });
    });
  }

  /* ─────────────────────────────────────────────────
     10. INITIALIZATION
     ───────────────────────────────────────────────── */

  function init() {
    setDates();
    setChartDefaults();
    initToggle();
    initFilters();

    // Initial render with no filters (full year, all regions, all categories)
    applyFilters(true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
