const formatCurrency = (value) => {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numericValue);
};

const toDate = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string") {
    const trimmedValue = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmedValue)) {
      const [year, month, day] = trimmedValue.split("-").map(Number);
      return new Date(year, month - 1, day);
    }
  }

  const parsed = value ? new Date(value) : null;
  return Number.isNaN(parsed?.getTime()) ? null : parsed;
};

const createDayRange = (now = new Date(), timeZoneOffsetMinutes = null) => {
  const effectiveOffset = Number.isFinite(timeZoneOffsetMinutes) ? timeZoneOffsetMinutes : now.getTimezoneOffset();
  const localDate = new Date(now.getTime() + effectiveOffset * 60 * 1000);
  const startUtc = new Date(
    Date.UTC(
      localDate.getUTCFullYear(),
      localDate.getUTCMonth(),
      localDate.getUTCDate()
    ) - effectiveOffset * 60 * 1000
  );

  const end = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);

  return { start: startUtc, end };
};

const createPreviousDayRange = (now = new Date(), timeZoneOffsetMinutes = null) => {
  const { start } = createDayRange(now, timeZoneOffsetMinutes);
  const previousStart = new Date(start.getTime() - 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime());

  return { start: previousStart, end };
};

const toLocalDateString = (value = new Date()) => {
  const date = toDate(value) || new Date(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shouldReuseExistingReport = (existingReport, requestedDate = new Date(), latestEventTime = null) => {
  if (!existingReport?.reportDate) return false;

  const normalizedDate = toDate(requestedDate) || new Date(requestedDate);
  if (!normalizedDate || Number.isNaN(normalizedDate.getTime())) {
    return false;
  }

  const requestedDateKey = toLocalDateString(normalizedDate);
  const existingDate = toDate(existingReport.reportDate);
  const existingDateKey = existingDate ? toLocalDateString(existingDate) : String(existingReport.reportDate || "").trim().slice(0, 10);

  if (!requestedDateKey || !existingDateKey || requestedDateKey !== existingDateKey) {
    return false;
  }

  const generatedAt = toDate(existingReport?.generatedAt);
  const latestAnalyticsAt = toDate(latestEventTime);
  if (generatedAt && latestAnalyticsAt && latestAnalyticsAt.getTime() > generatedAt.getTime()) {
    return false;
  }

  const engagement = existingReport?.engagement || {};
  const hasEngagementData = ["mostSearchedTerms", "mostClickedItems", "clickLocations", "clicksPerCountry", "topRegions", "sessionDuration"].every((key) => {
    if (key === "sessionDuration") {
      const sessionDuration = engagement?.sessionDuration || {};
      return Number(sessionDuration?.averageSeconds) > 0 || Number(sessionDuration?.longestSeconds) > 0;
    }

    if (key === "clicksPerCountry") {
      const value = engagement?.[key];
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return Boolean(value);
    }

    const value = engagement?.[key];
    if (Array.isArray(value)) {
      return value.length > 0;
    }

    return Boolean(value);
  });
  const hasCategoryData = Array.isArray(existingReport?.categories?.bestSelling) && existingReport.categories.bestSelling.length > 0;
  const hasCustomerData = Object.prototype.hasOwnProperty.call(existingReport, "customers") && existingReport?.customers !== null && Number(existingReport?.customers?.repeatCustomers || 0) >= 0;

  if (hasEngagementData && hasCategoryData && hasCustomerData) {
    return true;
  }

  return false;
};

const normalizeProductName = (value) => String(value || "").trim();

const getProductKey = (product) => {
  const keys = [];
  const id = String(product?._id || product?.id || "").trim();
  if (id) keys.push(id);
  const name = normalizeProductName(product?.name);
  if (name) keys.push(name.toLowerCase());
  return keys;
};

const buildProductLookup = (products = []) => {
  const lookup = new Map();

  products.forEach((product) => {
    const keys = getProductKey(product);
    keys.forEach((key) => lookup.set(key, product));
  });

  return lookup;
};

const inferProductNameFromEvent = (event) => {
  const metadata = event?.metadata || {};
  if (normalizeProductName(metadata.productName)) return metadata.productName;
  if (normalizeProductName(metadata.name)) return metadata.name;
  if (normalizeProductName(event?.productName)) return event.productName;
  if (normalizeProductName(event?.product?.name)) return event.product.name;
  return "";
};

const inferProductIdFromEvent = (event) => {
  const metadata = event?.metadata || {};
  const candidates = [metadata.productId, metadata.id, event?.productId, event?.product?.id];
  return candidates.find((candidate) => normalizeProductName(candidate)) || "";
};

const isPageViewEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  return type === "page_view" || type === "visit" || type === "landing";
};

const isCartEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  return type.includes("cart") || type.includes("add_to_cart") || type.includes("checkout");
};

const isProductViewEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  if (type.includes("view") && !type.includes("page")) return true;
  if (type.includes("product")) return true;
  const productName = inferProductNameFromEvent(event);
  return Boolean(productName) && !isPageViewEvent(event) && !isCartEvent(event);
};

const isSearchEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  return type === "search" || type === "search_query" || type === "search_term";
};

const isClickedItemEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  return type === "click_item" || type === "item_click" || type === "product_click";
};

const getEventProductReference = (event) => {
  const productName = inferProductNameFromEvent(event);
  const productId = inferProductIdFromEvent(event);
  return { productName, productId };
};

const buildBusinessReportSnapshot = ({
  orders = [],
  products = [],
  analyticsEvents = [],
  dailyOrders = null,
  previousDayOrders = null,
  dailyEvents = null,
  now = new Date(),
  reportDateKey = null,
  timeZoneOffsetMinutes = null,
} = {}) => {
  const { start, end } = createDayRange(now, timeZoneOffsetMinutes);
  const { start: previousStart, end: previousEnd } = createPreviousDayRange(now, timeZoneOffsetMinutes);

  const resolvedDailyOrders = dailyOrders ?? (orders || []).filter((order) => {
    const createdAt = toDate(order?.createdAt || order?.created_at);
    return createdAt && createdAt >= start && createdAt < end;
  });

  const resolvedDailyEvents = dailyEvents ?? (analyticsEvents || []).filter((event) => {
    const createdAt = toDate(event?.createdAt || event?.created_at);
    return createdAt && createdAt >= start && createdAt < end;
  });

  const resolvedPreviousDayOrders = previousDayOrders ?? (orders || []).filter((order) => {
    const createdAt = toDate(order?.createdAt || order?.created_at);
    return createdAt && createdAt >= previousStart && createdAt < previousEnd;
  });

  const revenue = resolvedDailyOrders.reduce((total, order) => total + Number(order?.totalAmount || 0), 0);
  const pendingOrders = resolvedDailyOrders.filter((order) => String(order?.status || "").trim().toLowerCase() === "pending").length;
  const approvedOrders = resolvedDailyOrders.filter((order) => String(order?.status || "").trim().toLowerCase() === "approved").length;
  const rejectedOrders = resolvedDailyOrders.filter((order) => {
    const normalizedStatus = String(order?.status || "").trim().toLowerCase();
    return normalizedStatus === "rejected" || normalizedStatus === "cancelled" || normalizedStatus === "canceled";
  }).length;
  const averageOrderValue = resolvedDailyOrders.length > 0 ? revenue / resolvedDailyOrders.length : 0;

  const productDemandMap = new Map();
  const orderedProductsMap = new Map();
  const categoryDemandMap = new Map();
  const productLookup = buildProductLookup(products || []);

  resolvedDailyOrders.forEach((order) => {
    const items = Array.isArray(order?.orderItems) ? order.orderItems : [];
    items.forEach((item) => {
      const name = String(item?.name || "Unknown product").trim();
      const quantity = Number(item?.cartQuantity ?? item?.quantity ?? 0);
      if (!name || !Number.isFinite(quantity) || quantity <= 0) {
        return;
      }

      const existing = productDemandMap.get(name) || { name, quantity: 0, revenue: 0 };
      existing.quantity += quantity;
      existing.revenue += Number(item?.price || 0) * quantity;
      productDemandMap.set(name, existing);

      const orderedProduct = orderedProductsMap.get(name) || { name, quantity: 0, revenue: 0 };
      orderedProduct.quantity += quantity;
      orderedProduct.revenue += Number(item?.price || 0) * quantity;
      orderedProductsMap.set(name, orderedProduct);

      const matchedProduct = productLookup.get(name.toLowerCase()) || productLookup.get(String(item?._id || item?.productId || ""));
      const categoryName = normalizeProductName(matchedProduct?.category || "Uncategorized");
      const categoryEntry = categoryDemandMap.get(categoryName) || { category: categoryName, quantity: 0, revenue: 0 };
      categoryEntry.quantity += quantity;
      categoryEntry.revenue += Number(item?.price || 0) * quantity;
      categoryDemandMap.set(categoryName, categoryEntry);
    });
  });

  const topProducts = Array.from(productDemandMap.values())
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 5);

  const cartEventMap = new Map();
  resolvedDailyEvents.forEach((event) => {
    if (!isCartEvent(event)) return;

    const { productName, productId } = getEventProductReference(event);
    const reference = productName || productId || String(event?.page || "").trim();
    if (!reference) return;

    const existing = cartEventMap.get(reference) || { name: productName || reference, count: 0 };
    existing.count += 1;
    cartEventMap.set(reference, existing);
  });

  const viewedProductMap = new Map();
  resolvedDailyEvents.forEach((event) => {
    if (!isProductViewEvent(event)) return;

    const { productName, productId } = getEventProductReference(event);
    const reference = productName || productId || String(event?.page || "").trim();
    if (!reference) return;

    const existing = viewedProductMap.get(reference) || { name: productName || reference, count: 0 };
    existing.count += 1;
    viewedProductMap.set(reference, existing);
  });

  const searchTermMap = new Map();
  const clickedItemMap = new Map();
  const clickLocationMap = new Map();
  const sessionTimeline = new Map();

  resolvedDailyEvents.forEach((event) => {
    if (isSearchEvent(event)) {
      const query = String(event?.metadata?.query || event?.query || event?.search || "").trim();
      if (!query) return;

      const existing = searchTermMap.get(query.toLowerCase()) || { term: query, count: 0 };
      existing.count += 1;
      searchTermMap.set(query.toLowerCase(), existing);
    }

    if (isClickedItemEvent(event)) {
      const { productName, productId } = getEventProductReference(event);
      const reference = productName || productId || String(event?.metadata?.itemName || event?.itemName || "").trim();
      if (!reference) return;

      const existing = clickedItemMap.get(reference.toLowerCase()) || { name: productName || reference, count: 0 };
      existing.count += 1;
      clickedItemMap.set(reference.toLowerCase(), existing);

      const country = String(event?.country || event?.metadata?.country || "Unknown").trim() || "Unknown";
      const region = String(event?.region || event?.metadata?.region || "Unknown").trim() || "Unknown";
      const locationKey = `${country.toLowerCase()}::${region.toLowerCase()}`;
      const locationEntry = clickLocationMap.get(locationKey) || { country, region, count: 0 };
      locationEntry.count += 1;
      clickLocationMap.set(locationKey, locationEntry);
    }

    const sessionId = String(event?.sessionId || event?.metadata?.sessionId || "").trim();
    if (sessionId) {
      const createdAt = toDate(event?.createdAt || event?.created_at);
      if (createdAt) {
        const sessionEvents = sessionTimeline.get(sessionId) || [];
        sessionEvents.push(createdAt);
        sessionTimeline.set(sessionId, sessionEvents);
      }
    }
  });

  const productDemandSignals = new Map();
  const registerSignal = (reference, name, field, increment = 1) => {
    if (!reference) return;

    const existing = productDemandSignals.get(reference) || {
      name: name || reference,
      views: 0,
      cartAdditions: 0,
      orders: 0,
    };

    existing[field] += increment;
    productDemandSignals.set(reference, existing);
  };

  viewedProductMap.forEach((entry, reference) => {
    registerSignal(reference, entry.name, "views", entry.count);
  });

  cartEventMap.forEach((entry, reference) => {
    registerSignal(reference, entry.name, "cartAdditions", entry.count);
  });

  resolvedDailyOrders.forEach((order) => {
    const seenProducts = new Set();
    const items = Array.isArray(order?.orderItems) ? order.orderItems : [];

    items.forEach((item) => {
      const name = String(item?.name || "Unknown product").trim();
      const productId = String(item?._id || item?.productId || "").trim();
      const reference = name || productId || "";
      if (!reference || seenProducts.has(reference)) return;

      seenProducts.add(reference);
      registerSignal(reference, name || reference, "orders", 1);
    });
  });

  const purchasedNames = new Set(Array.from(orderedProductsMap.keys()));
  const viewedButNotPurchased = Array.from(viewedProductMap.values())
    .filter((entry) => !purchasedNames.has(entry.name))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const previousDayDemandMap = new Map();
  resolvedPreviousDayOrders.forEach((order) => {
    const items = Array.isArray(order?.orderItems) ? order.orderItems : [];
    items.forEach((item) => {
      const name = String(item?.name || "Unknown product").trim();
      const quantity = Number(item?.cartQuantity ?? item?.quantity ?? 0);
      if (!name || !Number.isFinite(quantity) || quantity <= 0) return;
      const existing = previousDayDemandMap.get(name) || { name, quantity: 0 };
      existing.quantity += quantity;
      previousDayDemandMap.set(name, existing);
    });
  });

  const increasingDemandProducts = Array.from(productDemandMap.values())
    .map((entry) => {
      const previousEntry = previousDayDemandMap.get(entry.name);
      return {
        ...entry,
        previousQuantity: previousEntry?.quantity || 0,
        trend: previousEntry && entry.quantity > previousEntry.quantity ? "increasing" : "steady",
      };
    })
    .filter((entry) => entry.trend === "increasing")
    .sort((left, right) => right.quantity - left.quantity)
    .slice(0, 5);

  const mostDemandedProducts = Array.from(productDemandSignals.values())
    .sort((left, right) => {
      const scoreLeft = left.views + left.cartAdditions + left.orders;
      const scoreRight = right.views + right.cartAdditions + right.orders;
      return scoreRight - scoreLeft || right.views - left.views || right.orders - left.orders;
    })
    .slice(0, 5);

  const attentionWithoutSales = Array.from(productDemandSignals.values())
    .filter((entry) => entry.views > 0 && entry.orders === 0)
    .sort((left, right) => right.views - left.views || right.cartAdditions - left.cartAdditions)
    .slice(0, 5);

  const mostSearchedTerms = Array.from(searchTermMap.values())
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, 5);

  const mostClickedItems = Array.from(clickedItemMap.values())
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 5);

  const clickLocations = Array.from(clickLocationMap.values())
    .sort((left, right) => right.count - left.count || left.country.localeCompare(right.country) || left.region.localeCompare(right.region))
    .slice(0, 10);

  const clicksPerCountry = Array.from(clickLocationMap.values())
    .reduce((accumulator, location) => {
      const key = location.country;
      const existing = accumulator.get(key) || { country: key, count: 0 };
      existing.count += location.count;
      accumulator.set(key, existing);
      return accumulator;
    }, new Map())
    .values()
    .toArray()
    .sort((left, right) => right.count - left.count || left.country.localeCompare(right.country))
    .slice(0, 10);

  const topRegions = Array.from(clickLocationMap.values())
    .reduce((accumulator, location) => {
      const key = `${location.country} / ${location.region}`;
      const existing = accumulator.get(key) || { label: key, count: 0 };
      existing.count += location.count;
      accumulator.set(key, existing);
      return accumulator;
    }, new Map())
    .values()
    .toArray()
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, 5);

  const sessionDurations = Array.from(sessionTimeline.values())
    .map((events) => events.slice().sort((left, right) => left.getTime() - right.getTime()))
    .map((events) => {
      if (events.length < 2) return 0;
      return Math.max(0, Math.round((events[events.length - 1].getTime() - events[0].getTime()) / 1000));
    })
    .filter((value) => value > 0);

  if (sessionDurations.length === 0) {
    const fallbackEvents = resolvedDailyEvents
      .map((event) => toDate(event?.createdAt || event?.created_at))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime());

    if (fallbackEvents.length >= 2) {
      sessionDurations.push(Math.max(0, Math.round((fallbackEvents[fallbackEvents.length - 1].getTime() - fallbackEvents[0].getTime()) / 1000)));
    }
  }

  const averageSessionDuration = sessionDurations.length > 0
    ? Math.round(sessionDurations.reduce((total, value) => total + value, 0) / sessionDurations.length)
    : 0;
  const longestSessionDuration = sessionDurations.length > 0
    ? Math.max(...sessionDurations)
    : 0;

  const lowStockProducts = (products || [])
    .filter((product) => Number(product?.stock || 0) <= 5)
    .sort((left, right) => Number(left?.stock || 0) - Number(right?.stock || 0))
    .slice(0, 5);

  const pageViewEvents = resolvedDailyEvents.filter((event) => isPageViewEvent(event));
  const trafficCount = pageViewEvents.length;
  const uniqueVisitors = new Set(
    pageViewEvents
      .map((event) => String(event?.ip || event?.userAgent || "unknown").trim())
      .filter(Boolean)
  ).size;

  const conversionRate = trafficCount > 0 ? (resolvedDailyOrders.length / trafficCount) * 100 : 0;

  const repeatCustomers = Array.from(
    new Map(
      (orders || [])
        .map((order) => {
          const email = String(order?.customer?.email || order?.user?.email || "").trim().toLowerCase();
          const phone = String(order?.customer?.phone || "").trim();
          return [email || phone, order];
        })
        .filter((entry) => Boolean(entry[0]))
    ).values()
  );

  const repeatCustomerCount = repeatCustomers.filter((order) => {
    const email = String(order?.customer?.email || order?.user?.email || "").trim().toLowerCase();
    const phone = String(order?.customer?.phone || "").trim();
    const customerKey = email || phone;
    return (orders || []).filter((candidate) => {
      const candidateEmail = String(candidate?.customer?.email || candidate?.user?.email || "").trim().toLowerCase();
      const candidatePhone = String(candidate?.customer?.phone || "").trim();
      const candidateKey = candidateEmail || candidatePhone;
      return candidateKey && candidateKey === customerKey;
    }).length > 1;
  }).length;

  const insights = [];
  if (topProducts.length > 0) {
    const leadProduct = topProducts[0];
    insights.push(`Top product demand: ${leadProduct.name} (${leadProduct.quantity} units)`);
  }

  if (trafficCount > 0) {
    insights.push(`Traffic reached ${trafficCount} visits with ${uniqueVisitors} unique visitors`);
  } else {
    insights.push("Traffic was quiet today; consider a promotion or retargeting push.");
  }

  if (resolvedDailyOrders.length > 0) {
    insights.push(`Sales generated ${formatCurrency(revenue)} across ${resolvedDailyOrders.length} orders.`);
  } else {
    insights.push("No orders were recorded today. Review product visibility and promotional offers.");
  }

  if (lowStockProducts.length > 0) {
    const lowStockNames = lowStockProducts.map((product) => `${product.name} (${product.stock})`).join(", ");
    insights.push(`Low stock alert: ${lowStockNames}`);
  }

  return {
    reportDate: reportDateKey || toLocalDateString(start),
    traffic: {
      visits: trafficCount,
      uniqueVisitors,
      conversionRate: Number(conversionRate.toFixed(2)),
    },
    sales: {
      orders: resolvedDailyOrders.length,
      revenue,
      pendingOrders,
      approvedOrders,
      rejectedOrders,
      averageOrderValue: Number(averageOrderValue.toFixed(2)),
    },
    demand: {
      topProducts,
      orderedProducts: Array.from(orderedProductsMap.values()).sort((left, right) => right.quantity - left.quantity),
      cartAdditions: Array.from(cartEventMap.values()).sort((left, right) => right.count - left.count),
      viewedButNotPurchased,
      increasingDemandProducts,
      mostDemandedProducts,
      attentionWithoutSales,
    },
    engagement: {
      mostSearchedTerms,
      mostClickedItems,
      clickLocations,
      clicksPerCountry,
      locationBreakdown: clickLocations,
      topRegions,
      sessionDuration: {
        averageSeconds: averageSessionDuration,
        longestSeconds: longestSessionDuration,
      },
    },
    categories: {
      bestSelling: Array.from(categoryDemandMap.values()).sort((left, right) => right.quantity - left.quantity),
    },
    customers: {
      repeatCustomers: repeatCustomerCount,
    },
    inventory: {
      lowStockProducts,
    },
    insights,
  };
};

module.exports = {
  buildBusinessReportSnapshot,
  formatCurrency,
  createDayRange,
  createPreviousDayRange,
  shouldReuseExistingReport,
};
