function compactText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

function absoluteUrl(value, baseUrl) {
  if (!value || /^data:/i.test(value)) return "";
  try {
    return new URL(decodeEntities(value), baseUrl).href;
  } catch {
    return "";
  }
}

function firstSrcFromSrcset(value) {
  const first = String(value || "").split(",")[0] || "";
  return first.trim().split(/\s+/)[0] || "";
}

function stripTags(value) {
  return compactText(String(value || "").replace(/<[^>]+>/g, " "));
}

function attrValue(tag, attr) {
  const regex = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "i");
  const match = tag.match(regex);
  return match ? decodeEntities(match[1]) : "";
}

function classifyImage({ src, alt, context }) {
  const directText = `${src} ${alt}`.toLowerCase();
  if (/ingredient|formula|配方|成分|原料|bom/.test(directText)) return "ingredient";
  if (/spec|sku|规格|参数|净含量|尺寸|口味/.test(directText)) return "spec";
  if (/detail|desc|详情|介绍|卖点|功能|功效/.test(directText)) return "detail";
  if (/main|cover|主图|首图/.test(directText)) return "main";
  if (/price|价格|券|到手|优惠|促销/.test(directText)) return "price";

  const text = `${directText} ${context}`.toLowerCase();
  if (/ingredient|formula|配方|成分|原料|bom/.test(text)) return "ingredient";
  if (/spec|sku|规格|参数|净含量|尺寸|口味/.test(text)) return "spec";
  if (/detail|desc|详情|介绍|卖点|功能|功效/.test(text)) return "detail";
  if (/main|cover|主图|首图/.test(text)) return "main";
  if (/price|价格|券|到手|优惠|促销/.test(text)) return "price";
  return "unknown";
}

function scoreImage({ src, alt, context, type }) {
  let score = 30;
  const text = `${src} ${alt} ${context}`.toLowerCase();
  if (type !== "unknown") score += 25;
  if (/详情|detail|desc|规格|spec|配方|ingredient|price|价格|到手/.test(text)) score += 20;
  if (/\.(jpg|jpeg|png|webp|avif|svg)(\?|$)/i.test(src)) score += 10;
  if (/logo|icon|sprite|avatar|favicon|qrcode|qr|loading|blank/.test(text)) score -= 35;
  if (/banner|main|cover|主图/.test(text)) score += 5;
  return Math.max(0, Math.min(100, score));
}

function nearbyContext(html, index) {
  const start = Math.max(0, index - 240);
  const end = Math.min(html.length, index + 360);
  return stripTags(html.slice(start, end)).slice(0, 220);
}

function extractImgTags(html, baseUrl) {
  const images = [];
  const regex = /<img\b[^>]*>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const tag = match[0];
    const rawSrc =
      attrValue(tag, "src") ||
      attrValue(tag, "data-src") ||
      attrValue(tag, "data-original") ||
      attrValue(tag, "data-lazy") ||
      firstSrcFromSrcset(attrValue(tag, "srcset")) ||
      firstSrcFromSrcset(attrValue(tag, "data-srcset"));
    const src = absoluteUrl(rawSrc, baseUrl);
    if (!src) continue;

    const alt = attrValue(tag, "alt") || attrValue(tag, "title");
    const context = nearbyContext(html, match.index);
    const type = classifyImage({ src, alt, context });
    const confidence = scoreImage({ src, alt, context, type });
    if (confidence < 25) continue;

    images.push({
      url: src,
      type,
      alt: compactText(alt),
      confidence,
      evidence: context
    });
  }

  return images;
}

function extractMetaImages(html, baseUrl) {
  const images = [];
  const regex = /<meta\b[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = absoluteUrl(match[1], baseUrl);
    if (!url) continue;
    images.push({
      url,
      type: "main",
      alt: "页面主图",
      confidence: 65,
      evidence: "meta image"
    });
  }
  return images;
}

function uniqueImages(images) {
  const seen = new Set();
  return images.filter((image) => {
    const key = image.url.split("#")[0];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractDetailImages({ html, url }) {
  const images = uniqueImages([...extractMetaImages(html, url), ...extractImgTags(html, url)])
    .sort((a, b) => b.confidence - a.confidence);

  return {
    ok: images.length > 0,
    pageUrl: url,
    images,
    capturedAt: new Date().toISOString()
  };
}

module.exports = {
  extractDetailImages
};
