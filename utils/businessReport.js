const formatCurrency = (value) => {
  const numericValue = Number(value || 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(numericValue);
};

const toDate = (value) => {
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

const isCartEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  return type.includes("cart") || type.includes("add_to_cart") || type.includes("checkout");
};

const isProductViewEvent = (event) => {
  const type = String(event?.eventType || "").trim().toLowerCase();
  if (type.includes("view") || type.includes("product")) return true;
  const productName = inferProductNameFromEvent(event);
  return Boolean(productName);
};

const getEventProductReference = (event) => {
  const productName = inferProductNameFromEvent(event);
  const productId = inferProductIdFromEvent(event);
  return { productName, productId };
};

const buildBusinessReportSnapshot = ({ orders = [], products = [], analyticsEvents = [], now = new Date() } = {}) => {
  const { start, end } = createDayRange(now);
  const { start: previousStart, end: previousEnd } = createPreviousDayRange(now);

  const dailyOrders = (orders || []).filter((order) => {
    const createdAt = toDate(order?.createdAt || order?.created_at);
    return createdAt && createdAt >= start && createdAt < end;
  });

  const dailyEvents = (analyticsEvents || []).filter((event) => {
    const createdAt = toDate(event?.createdAt || event?.created_at);
    return createdAt && createdAt >= start && createdAt < end;
  });

  const previousDayOrders = (orders || []).filter((order) => {
    const createdAt = toDate(order?.createdAt || order?.created_at);
    return createdAt && createdAt >= previousStart && createdAt < previousEnd;
  });

  const revenue = dailyOrders.reduce((total, order) => total + Number(order?.totalAmount || 0), 0);
  const pendingOrders = dailyOrders.filter((order) => String(order?.status || "").trim().toLowerCase() === "pending").length;
  const approvedOrders = dailyOrders.filter((order) => String(order?.status || "").trim().toLowerCase() === "approved").length;
  const averageOrderValue = dailyOrders.length > 0 ? revenue / dailyOrders.length : 0;

  const productDemandMap = new Map();
  const orderedProductsMap = new Map();
  const categoryDemandMap = new Map();
  const productLookup = buildProductLookup(products || []);

  dailyOrders.forEach((order) => {
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
  dailyEvents.forEach((event) => {
    if (!isCartEvent(event)) return;

    const { productName, productId } = getEventProductReference(event);
    const reference = productName || productId || String(event?.page || "").trim();
    if (!reference) return;

    const existing = cartEventMap.get(reference) || { name: productName || reference, count: 0 };
    existing.count += 1;
    cartEventMap.set(reference, existing);
  });

  const viewedProductMap = new Map();
  dailyEvents.forEach((event) => {
    if (!isProductViewEvent(event)) return;

    const { productName, productId } = getEventProductReference(event);
    const reference = productName || productId || String(event?.page || "").trim();
    if (!reference) return;

    const existing = viewedProductMap.get(reference) || { name: productName || reference, count: 0 };
    existing.count += 1;
    viewedProductMap.set(reference, existing);
  });

  const purchasedNames = new Set(Array.from(orderedProductsMap.keys()));
  const viewedButNotPurchased = Array.from(viewedProductMap.values())
    .filter((entry) => !purchasedNames.has(entry.name))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  const previousDayDemandMap = new Map();
  previousDayOrders.forEach((order) => {
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

  const lowStockProducts = (products || [])
    .filter((product) => Number(product?.stock || 0) <= 5)
    .sort((left, right) => Number(left?.stock || 0) - Number(right?.stock || 0))
    .slice(0, 5);

  const trafficCount = dailyEvents.length;
  const uniqueVisitors = new Set(
    dailyEvents
      .map((event) => String(event?.ip || event?.userAgent || "unknown").trim())
      .filter(Boolean)
  ).size;

  const conversionRate = trafficCount > 0 ? (dailyOrders.length / trafficCount) * 100 : 0;

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

  if (dailyOrders.length > 0) {
    insights.push(`Sales generated ${formatCurrency(revenue)} across ${dailyOrders.length} orders.`);
  } else {
    insights.push("No orders were recorded today. Review product visibility and promotional offers.");
  }

  if (lowStockProducts.length > 0) {
    const lowStockNames = lowStockProducts.map((product) => `${product.name} (${product.stock})`).join(", ");
    insights.push(`Low stock alert: ${lowStockNames}`);
  }

  return {
    reportDate: start.toISOString(),
    traffic: {
      visits: trafficCount,
      uniqueVisitors,
      conversionRate: Number(conversionRate.toFixed(2)),
    },
    sales: {
      orders: dailyOrders.length,
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
};
