const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const workspace = path.resolve(__dirname, "..");
const nodeModules = "/Users/luo_chao/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const { chromium } = require(path.join(nodeModules, "playwright"));
const analyzer = require(path.join(workspace, "extension/shared/analyzer.js"));
const { createCrawlerServer } = require(path.join(workspace, "server/price-crawler.js"));
const { parseOfficialPrice } = require(path.join(workspace, "server/price-extractor.js"));
const { extractDetailImages } = require(path.join(workspace, "server/detail-image-extractor.js"));

function assertIncludes(value, expected, message) {
  assert.ok(String(value).includes(expected), `${message}\nExpected to include: ${expected}\nActual: ${value}`);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}`
      });
    });
  });
}

function startServer(root) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(root, safePath === "/" ? "demo/approval-page.html" : safePath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const contentType = filePath.endsWith(".html")
        ? "text/html; charset=utf-8"
        : filePath.endsWith(".css")
          ? "text/css; charset=utf-8"
          : filePath.endsWith(".svg")
            ? "image/svg+xml; charset=utf-8"
          : "application/javascript; charset=utf-8";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/demo/approval-page.html`
      });
    });
  });
}

async function runAnalyzerTests() {
  const text = `
    商品名称
    喜崽 新品上新 喜崽鲜泥混合价猫餐盒湿粮猫罐头主食猫头拌饭 1kg
    商品编码
    100283434137
    品牌
    喜崽
    类目
    宠物生活 / 猫粮 / 膨化粮
    规格
    1kg
    采购价
    30.00
    京东价
    60.92
    预估毛利率
    70%
  `;
  const extracted = analyzer.extractFromText(text);
  assertIncludes(extracted.productName, "喜崽", "should extract product name");
  assert.equal(extracted.skuId, "100283434137", "should extract SKU ID");
  assert.equal(extracted.purchasePrice, 30, "should extract purchase price across line breaks");
  assert.equal(extracted.jdPrice, 60.92, "should extract JD price across line breaks");
  assert.equal(extracted.expectedGrossMargin, 70, "should extract gross margin across line breaks");

  const result = analyzer.analyze({
    ...extracted,
    officialPrice: 27.99,
    lowPrice: 14.2,
    bomLow: 19,
    bomHigh: 21,
    controllableRate: 12,
    uncontrollableRate: 2.5,
    adRate: 0,
    targetProfitRate: 12
  });

  assert.equal(result.riskLevel, "高", "sample SKU should be high risk");
  assert.equal(Number(result.suggestedPurchasePrice.toFixed(2)), 20.57, "should calculate suggested purchase price");
  assert.equal(result.scenarios[2].status, "亏损", "lowest deal scenario should be loss-making");
  assertIncludes(result.reviewText, "建议驳回", "review text should include recommendation");
}

async function runPriceExtractorTests(demoBaseUrl) {
  const html = fs.readFileSync(path.join(workspace, "demo/official-store-page.html"), "utf8");
  const parsed = parseOfficialPrice({
    html,
    url: `${demoBaseUrl}/demo/official-store-page.html`,
    productName: "喜崽鲜泥混合价猫餐盒湿粮猫罐头主食猫头拌饭 1kg",
    brand: "喜崽",
    spec: "1kg"
  });

  assert.equal(parsed.finalPrice, 27.99, "should parse official final price");
  assert.equal(parsed.shopName, "喜崽官方旗舰店", "should parse official shop name");
  assert.ok(parsed.confidence >= 70, "official page should have high confidence");

  const images = extractDetailImages({
    html,
    url: `${demoBaseUrl}/demo/official-store-page.html`
  });
  assert.equal(images.ok, true, "should extract detail images");
  assert.ok(images.images.length >= 3, "should collect at least three detail images");
  assert.ok(images.images.some((image) => image.type === "ingredient"), "should classify ingredient image");
  assert.ok(images.images.some((image) => image.type === "spec"), "should classify spec image");
}

async function runBrowserTests() {
  const { server, url } = await startServer(workspace);
  const crawler = await listen(createCrawlerServer());
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  });

  try {
    await runPriceExtractorTests(new URL(url).origin);
    const page = await browser.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: async (text) => {
            window.__purchaseAssistantCopiedText = text;
          }
        },
        configurable: true
      });
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.addStyleTag({ path: path.join(workspace, "extension/content/sidebar.css") });
    await page.addScriptTag({ path: path.join(workspace, "extension/shared/analyzer.js") });
    await page.addScriptTag({ path: path.join(workspace, "extension/content/content.js") });
    await page.evaluate(() => window.PurchaseAssistantUI.open());

    await page.locator("#purchase-assistant-root:not(.pa-hidden)").waitFor();
    await assertField(page, "productName", /喜崽/);
    await assertField(page, "skuId", "100283434137");
    await assertField(page, "purchasePrice", "30");
    await assertField(page, "jdPrice", "60.92");

    await page.locator('[data-pa-field="officialUrl"]').fill(`${new URL(url).origin}/demo/official-store-page.html`);
    await page.locator('[data-pa-field="crawlerEndpoint"]').fill(`${crawler.url}/api/official-price`);
    await page.locator('[data-pa-field="detailImageEndpoint"]').fill(`${crawler.url}/api/detail-images`);
    await page.locator('[data-pa-action="crawl-detail-images"]').click();
    await page.locator("[data-pa-crawl-status]", { hasText: "已采集" }).waitFor();
    const imageTableText = await page.locator("[data-pa-image-list]").innerText();
    assertIncludes(imageTableText, "ingredient", "detail image table should include ingredient image");
    assertIncludes(imageTableText, "spec", "detail image table should include spec image");

    await page.locator('[data-pa-action="crawl-official-price"]').click();
    await page.waitForFunction(() => document.querySelector('[data-pa-field="officialPrice"]')?.value === "27.99");
    await page.locator("[data-pa-crawl-status]", { hasText: "喜崽官方旗舰店" }).waitFor();

    await page.locator('[data-pa-field="lowPrice"]').fill("14.2");
    await page.locator('[data-pa-field="bomLow"]').fill("19");
    await page.locator('[data-pa-field="bomHigh"]').fill("21");
    await page.locator('[data-pa-action="analyze"]').click();

    await page.locator('[data-pa-risk]', { hasText: "高风险" }).waitFor();
    const resultText = await page.locator("[data-pa-result]").innerText();
    assertIncludes(resultText, "建议驳回", "result should show reject or reduce cost recommendation");
    assertIncludes(resultText, "20.57 元", "result should show calculated suggested purchase price");
    assertIncludes(resultText, "最低凑单场景", "result should show scenario table");

    await page.locator('[data-pa-action="copy"]').click();
    const copied = await page.evaluate(() => window.__purchaseAssistantCopiedText);
    assertIncludes(copied, "审核建议", "copy should include review heading");
    assertIncludes(copied, "建议采购价：20.57 元", "copy should include suggested purchase price");

    const commandPage = await browser.newPage();
    await commandPage.goto(url, { waitUntil: "domcontentloaded" });
    await commandPage.addStyleTag({ path: path.join(workspace, "extension/content/sidebar.css") });
    await commandPage.addScriptTag({ path: path.join(workspace, "extension/shared/analyzer.js") });
    await commandPage.addScriptTag({ path: path.join(workspace, "extension/content/content.js") });
    await commandPage.evaluate(() => window.PurchaseAssistantUI.open());

    await commandPage.locator("#purchase-assistant-root:not(.pa-hidden)").waitFor();
    await commandPage.locator('[data-pa-field="officialUrl"]').fill(`${new URL(url).origin}/demo/official-store-page.html`);
    await commandPage.locator('[data-pa-field="crawlerEndpoint"]').fill(`${crawler.url}/api/official-price`);
    await commandPage.locator('[data-pa-field="detailImageEndpoint"]').fill(`${crawler.url}/api/detail-images`);
    await commandPage.locator('[data-pa-field="lowPrice"]').fill("14.2");
    await commandPage.locator('[data-pa-field="bomLow"]').fill("19");
    await commandPage.locator('[data-pa-field="bomHigh"]').fill("21");
    await commandPage.locator("[data-pa-command-input]").fill("帮我完整审核这单");
    await commandPage.locator('[data-pa-action="run-command"]').click();

    await commandPage.locator('[data-pa-risk]', { hasText: "高风险" }).waitFor();
    await commandPage.waitForFunction(() => document.querySelector('[data-pa-field="officialPrice"]')?.value === "27.99");
    const commandResultText = await commandPage.locator("[data-pa-result]").innerText();
    assertIncludes(commandResultText, "建议驳回", "natural language command should generate review result");
    assertIncludes(commandResultText, "20.57 元", "natural language command should calculate suggested purchase price");
    const decisionSummary = await commandPage.locator("[data-pa-decision-summary]").innerText();
    assertIncludes(decisionSummary, "建议驳回", "agent should show an immediate decision summary");
    assertIncludes(decisionSummary, "20.57 元", "decision summary should show suggested purchase price");
    assertIncludes(await commandPage.locator("[data-pa-command-log]").innerText(), "高风险", "agent command log should show final risk");
    assertIncludes(await commandPage.locator("[data-pa-image-state]").innerText(), "3 张", "agent command should collect detail images");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => crawler.server.close(resolve));
  }
}

async function assertField(page, name, expected) {
  const value = await page.locator(`[data-pa-field="${name}"]`).inputValue();
  if (expected instanceof RegExp) {
    assert.match(value, expected, `field ${name} should match ${expected}`);
  } else {
    assert.equal(value, expected, `field ${name} should equal ${expected}`);
  }
}

(async () => {
  await runAnalyzerTests();
  await runBrowserTests();
  console.log("acceptance tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
