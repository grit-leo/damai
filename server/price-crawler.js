const http = require("node:http");
const { parseOfficialPrice } = require("./price-extractor");
const { extractDetailImages } = require("./detail-image-extractor");

const DEFAULT_PORT = Number(process.env.PRICE_CRAWLER_PORT || 8787);
const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function jsonResponse(res, statusCode, payload) {
  res.writeHead(statusCode, DEFAULT_HEADERS);
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function candidateUrls(payload) {
  const urls = [];
  if (payload.officialUrl) urls.push(payload.officialUrl);
  if (Array.isArray(payload.urls)) urls.push(...payload.urls);
  if (process.env.PRICE_CRAWLER_SEEDS) {
    urls.push(...process.env.PRICE_CRAWLER_SEEDS.split(",").map((item) => item.trim()).filter(Boolean));
  }
  return Array.from(new Set(urls.filter(Boolean)));
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function crawlOfficialPrice(payload) {
  const urls = candidateUrls(payload);
  if (!urls.length) {
    return {
      ok: false,
      error: "缺少官旗商品链接，或未配置 PRICE_CRAWLER_SEEDS 搜索种子。",
      candidates: []
    };
  }

  const candidates = [];
  const errors = [];

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const parsed = parseOfficialPrice({
        html,
        url,
        productName: payload.productName,
        brand: payload.brand,
        spec: payload.spec
      });
      if (parsed.finalPrice) candidates.push(parsed);
      else errors.push({ url, error: "未识别到有效价格" });
    } catch (error) {
      errors.push({ url, error: error.message });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence || (a.finalPrice || Infinity) - (b.finalPrice || Infinity));

  return {
    ok: candidates.length > 0,
    candidates,
    errors
  };
}

async function crawlDetailImages(payload) {
  const urls = candidateUrls(payload);
  if (!urls.length) {
    return {
      ok: false,
      error: "缺少商品详情页链接，或未配置 PRICE_CRAWLER_SEEDS 搜索种子。",
      images: [],
      pages: []
    };
  }

  const pages = [];
  const images = [];
  const errors = [];

  for (const url of urls) {
    try {
      const html = await fetchHtml(url);
      const parsed = extractDetailImages({ html, url });
      pages.push(parsed);
      images.push(...parsed.images);
      if (!parsed.images.length) errors.push({ url, error: "未识别到详情图片" });
    } catch (error) {
      errors.push({ url, error: error.message });
    }
  }

  const seen = new Set();
  const uniqueImages = images.filter((image) => {
    if (seen.has(image.url)) return false;
    seen.add(image.url);
    return true;
  });

  uniqueImages.sort((a, b) => b.confidence - a.confidence);

  return {
    ok: uniqueImages.length > 0,
    images: uniqueImages,
    pages,
    errors,
    capturedAt: new Date().toISOString()
  };
}

function createCrawlerServer() {
  return http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, DEFAULT_HEADERS);
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      jsonResponse(res, 200, { ok: true, service: "price-crawler" });
      return;
    }

    if (req.method === "POST" && req.url === "/api/official-price") {
      try {
        const payload = await readBody(req);
        const result = await crawlOfficialPrice(payload);
        jsonResponse(res, result.ok ? 200 : 422, result);
      } catch (error) {
        jsonResponse(res, 500, { ok: false, error: error.message, candidates: [] });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/detail-images") {
      try {
        const payload = await readBody(req);
        const result = await crawlDetailImages(payload);
        jsonResponse(res, result.ok ? 200 : 422, result);
      } catch (error) {
        jsonResponse(res, 500, { ok: false, error: error.message, images: [] });
      }
      return;
    }

    jsonResponse(res, 404, { ok: false, error: "Not found" });
  });
}

if (require.main === module) {
  const server = createCrawlerServer();
  server.listen(DEFAULT_PORT, "127.0.0.1", () => {
    console.log(`price crawler listening on http://127.0.0.1:${DEFAULT_PORT}`);
  });
}

module.exports = {
  createCrawlerServer,
  crawlOfficialPrice,
  crawlDetailImages
};
