function compactText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[%¥￥,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function stripHtml(html) {
  return compactText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, "\n")
  );
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function titleFromHtml(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return compactText(decodeEntities(match ? match[1] : ""));
}

function metaFromHtml(html, propertyNames) {
  for (const name of propertyNames) {
    const regex = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const match = String(html || "").match(regex);
    if (match) return compactText(decodeEntities(match[1]));
  }
  return "";
}

function collectLabeledPrices(text, html) {
  const candidates = [];
  const combined = `${text}\n${html}`;
  const patterns = [
    { label: "final", type: "到手价", regex: /(到手价|券后价|预估到手|实付价|成交价)[^\d¥￥]{0,20}[¥￥]?\s*([0-9]+(?:\.[0-9]+)?)/gi, weight: 100 },
    { label: "promo", type: "活动价", regex: /(活动价|促销价|秒杀价|直播价|会员价)[^\d¥￥]{0,20}[¥￥]?\s*([0-9]+(?:\.[0-9]+)?)/gi, weight: 80 },
    { label: "sale", type: "销售价", regex: /(现价|价格|京东价|标价)[^\d¥￥]{0,20}[¥￥]?\s*([0-9]+(?:\.[0-9]+)?)/gi, weight: 50 },
    { label: "data", type: "结构化价格", regex: /(?:salePrice|finalPrice|couponPrice|discountPrice|activityPrice|price)["']?\s*[:=]\s*["']?([0-9]+(?:\.[0-9]+)?)/gi, weight: 75 }
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.regex.exec(combined)) !== null) {
      const price = numberOrNull(match[2] || match[1]);
      if (price && price > 0 && price < 100000) {
        candidates.push({
          price,
          type: pattern.type,
          label: pattern.label,
          weight: pattern.weight,
          evidence: compactText(match[0]).slice(0, 120)
        });
      }
    }
  }

  return candidates;
}

function collectCouponDiscounts(text) {
  const discounts = [];
  const patterns = [
    /(?:领券|券|优惠券|店铺券|平台券)[^\d]{0,12}(?:减|立减|优惠)\s*([0-9]+(?:\.[0-9]+)?)/gi,
    /满\s*[0-9]+(?:\.[0-9]+)?\s*减\s*([0-9]+(?:\.[0-9]+)?)/gi
  ];

  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = numberOrNull(match[1]);
      if (value && value > 0 && value < 10000) discounts.push(value);
    }
  }

  return discounts;
}

function terms(value) {
  return compactText(value)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((item) => item && item.length >= 2);
}

function scoreCandidate({ title, shopName, text, productName, brand, spec, finalPrice }) {
  let score = 0;
  const haystack = `${title} ${shopName} ${text}`.toLowerCase();

  if (/官方旗舰店|旗舰店|品牌自营|官方店/.test(haystack)) score += 30;
  if (brand && haystack.includes(String(brand).toLowerCase())) score += 20;
  if (spec && haystack.includes(String(spec).toLowerCase())) score += 15;

  const productTerms = terms(productName).slice(0, 8);
  const matchedTerms = productTerms.filter((term) => haystack.includes(term));
  if (productTerms.length) score += Math.round((matchedTerms.length / productTerms.length) * 25);
  if (finalPrice) score += 10;

  return Math.min(100, score);
}

function parseOfficialPrice({ html, url, productName, brand, spec }) {
  const title = metaFromHtml(html, ["og:title"]) || titleFromHtml(html);
  const description = metaFromHtml(html, ["description", "og:description"]);
  const text = stripHtml(html);
  const shopNameMatch = text.match(/([\p{L}\p{N}_-]{2,40}(?:官方旗舰店|旗舰店|品牌自营|官方店))/u);
  const shopName = shopNameMatch ? shopNameMatch[1] : "";
  const priceCandidates = collectLabeledPrices(text, html);
  const couponDiscounts = collectCouponDiscounts(text);

  const ranked = priceCandidates
    .map((item) => ({
      ...item,
      sortKey: item.weight - item.price / 100000
    }))
    .sort((a, b) => b.sortKey - a.sortKey);

  let selected = ranked[0] || null;
  let finalPrice = selected ? selected.price : null;
  let priceType = selected ? selected.type : "";
  let evidence = selected ? selected.evidence : "";

  const salePrice = priceCandidates
    .filter((item) => item.label === "sale" || item.label === "promo")
    .sort((a, b) => a.price - b.price)[0];
  const bestDiscount = couponDiscounts.sort((a, b) => b - a)[0] || 0;

  if (!finalPrice && salePrice && bestDiscount) {
    finalPrice = Math.max(0, salePrice.price - bestDiscount);
    priceType = "券后价估算";
    evidence = `${salePrice.evidence}; 优惠约 ${bestDiscount}`;
  }

  const confidence = scoreCandidate({
    title,
    shopName,
    text: `${description} ${text.slice(0, 2000)}`,
    productName,
    brand,
    spec,
    finalPrice
  });

  return {
    platform: platformFromUrl(url),
    shopName,
    title,
    url,
    finalPrice,
    listPrice: salePrice ? salePrice.price : finalPrice,
    priceType,
    couponDiscount: bestDiscount || null,
    confidence,
    evidence,
    capturedAt: new Date().toISOString()
  };
}

function platformFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    if (/tmall|taobao/.test(hostname)) return "天猫/淘宝";
    if (/douyin|jinritemai/.test(hostname)) return "抖音";
    if (/jd\.com/.test(hostname)) return "京东";
    if (/pinduoduo|yangkeduo/.test(hostname)) return "拼多多";
    if (/localhost|127\.0\.0\.1/.test(hostname)) return "演示官旗";
    return hostname;
  } catch {
    return "未知平台";
  }
}

module.exports = {
  parseOfficialPrice,
  platformFromUrl,
  stripHtml
};
