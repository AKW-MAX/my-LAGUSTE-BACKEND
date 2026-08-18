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

const createDayRange = (now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return { start, end };
};

const createPreviousDayRange = (now = new Date()) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);

  const end = new Date(now);
  end.setHours(0, 0, 0, 0);

  return { start, end };
};

const toLocalDateString = (value = new Date()) => {
  const date = toDate(value) || new Date(value);
  if (!date) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const shouldReuseExistingReport = (existingReport, requestedDate = new Date()) => {
  if (!existingReport?.reportDate) return false;

  const normalizedDate = toDate(requestedDate) || new Date(requestedDate);
  if (!normalizedDate || Number.isNaN(normalizedDate.getTime())) {
    return false;
  }

  const requestedDateKey = toLocalDateString(normalizedDate);
  const existingDate = toDate(existingReport.reportDate);
  const existingDateKey = existingDate ? toLocalDateString(existingDate) : String(existingReport.reportDate || "").trim().slice(0, 10);

  return Boolean(requestedDateKey && existingDateKey && requestedDateKey === existingDateKey);
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
} = {}) => {
  const { start, end } = createDayRange(now);
  const { start: previousStart, end: previousEnd } = createPreviousDayRange(now);

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
    reportDate: toLocalDateString(start),
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
