const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const workspace = path.resolve(__dirname, "..");

function requireRuntimeModule(moduleName) {
  try {
    return require(moduleName);
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
  }

  const runtimeNodeModules = [
    process.env.PLAYWRIGHT_NODE_MODULES,
    process.env.HOME &&
      path.join(process.env.HOME, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules")
  ].filter(Boolean);

  for (const nodeModules of runtimeNodeModules) {
    try {
      return require(path.join(nodeModules, moduleName));
    } catch (error) {
      if (error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }

  throw new Error(`Cannot find ${moduleName}. Set PLAYWRIGHT_NODE_MODULES to the bundled node_modules path.`);
}

const { chromium } = requireRuntimeModule("playwright");
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

  const freightResult = analyzer.analyze({
    ...extracted,
    officialPrice: 27.99,
    lowPrice: 14.2,
    bomLow: 19,
    bomHigh: 21,
    controllableRate: 12,
    uncontrollableRate: 2.5,
    adRate: 0,
    targetProfitRate: 12,
    packageWeightKg: 1.1,
    packageLengthCm: 24,
    packageWidthCm: 18,
    packageHeightCm: 10,
    volumeDivisor: 8000,
    firstWeightKg: 1,
    firstFreightFee: 3.2,
    continuedWeightKg: 0.5,
    continuedFreightFee: 0.45,
    evidenceImageCount: 7
  });
  assert.equal(Number(freightResult.suggestedPurchasePrice.toFixed(2)), 16.92, "freight template should lower suggested purchase price");
  assert.equal(freightResult.logisticsCost, 3.65, "should include template freight cost");
  assert.equal(freightResult.freight.billedWeight, 1.5, "should round chargeable weight by continued weight unit");
  assert.equal(freightResult.freight.volumeWeight, 0.54, "should calculate volume weight with divisor");
  assert.equal(freightResult.priceAdvice.bomConflict, true, "freight-aware purchase cap should flag BOM conflict");
  assert.ok(freightResult.evidenceCompleteness >= 90, "full evidence should produce a high completeness score");
  assertIncludes(freightResult.reviewText, "计费重运费", "review text should include freight basis");
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRpaApiTests(crawlerUrl) {
  const startResponse = await fetch(`${crawlerUrl}/api/rpa/price/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productName: "西红柿",
      platform: "douyin",
      useRpa: true
    })
  });
  assert.equal(startResponse.status, 202, "RPA start should be async");
  const started = await startResponse.json();
  assert.ok(started.taskId, "RPA start should return a taskId");
  assert.equal(started.status, "running", "RPA task should start in running status");
  assert.equal(started.mock, false, "RPA task should not be mock on start");
  assertIncludes(started.phaseText, "真实", "RPA start should make the real-first waiting state visible");

  const firstResultResponse = await fetch(`${crawlerUrl}/api/rpa/price/result?taskId=${encodeURIComponent(started.taskId)}`);
  const firstResult = await firstResultResponse.json();
  assert.equal(firstResult.status, "running", "RPA task should stay running before fallback delay");
  assert.equal(firstResult.candidates.length, 0, "RPA task should not return mock candidates immediately");

  let result = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (attempt) await delay(300);
    const resultResponse = await fetch(`${crawlerUrl}/api/rpa/price/result?taskId=${encodeURIComponent(started.taskId)}`);
    result = await resultResponse.json();
    if (result.status === "succeeded") break;
  }

  assert.equal(result.status, "succeeded", "RPA fallback task should eventually succeed");
  assert.equal(result.mock, true, "RPA fallback should be marked explicitly");
  assert.equal(result.candidates[0].finalPrice, 8, "RPA fallback should return PDF sample price");
  assertIncludes(result.candidates[0].title, "番茄", "RPA fallback should return PDF sample SKU name");
  assert.equal(result.candidates[0].priceType, "演示兜底识价", "fallback evidence should not masquerade as real RPA");
  assert.ok(result.images.length >= 1, "RPA fallback should return image evidence");

  const directResponse = await fetch(`${crawlerUrl}/api/official-price`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productName: "西红柿",
      platform: "douyin",
      useRpa: true
    })
  });
  assert.equal(directResponse.status, 202, "official-price should expose async RPA task for RPA platforms");
  const directPayload = await directResponse.json();
  assert.ok(directPayload.taskId, "official-price RPA branch should return taskId");

  const aiResponse = await fetch(`${crawlerUrl}/api/ai/review-draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      result: {
        recommendation: "建议驳回或要求品牌降采后重新提报。",
        riskLevel: "高",
        riskScore: 120,
        suggestedPurchasePrice: 16.92,
        logisticsCost: 3.65,
        feeRate: 0.145,
        targetRate: 0.12,
        input: {
          productName: "喜崽鲜泥混合价猫餐盒 1kg",
          purchasePrice: 30,
          officialPrice: 27.99
        },
        priceAdvice: {
          purchaseLower: 15.99,
          purchaseUpper: 16.92
        },
        actionItems: ["要求品牌降采至 16.92 元以内。"],
        strengths: ["已按计费重扣减运费。"]
      }
    })
  });
  assert.equal(aiResponse.status, 200, "AI review proxy should respond");
  const aiPayload = await aiResponse.json();
  assert.equal(aiPayload.ok, true, "AI review proxy should return ok");
  assert.equal(aiPayload.provider, "local-rules", "AI review proxy should use local fallback without API key");
  assertIncludes(aiPayload.draft, "Boss 审批意见", "AI review draft should be usable for Boss review");
}

async function runBrowserTests() {
  const savedEnv = {
    RPA_MOCK_DELAY_MS: process.env.RPA_MOCK_DELAY_MS,
    RPA_NEXT_POLL_MS: process.env.RPA_NEXT_POLL_MS,
    YINGDAO_ACCESS_KEY_ID: process.env.YINGDAO_ACCESS_KEY_ID,
    YINGDAO_ACCESS_KEY_SECRET: process.env.YINGDAO_ACCESS_KEY_SECRET,
    YINGDAO_PRICE_ROBOT_UUID: process.env.YINGDAO_PRICE_ROBOT_UUID,
    YINGDAO_ACCOUNT_NAME: process.env.YINGDAO_ACCOUNT_NAME,
    ZZZ_API_KEY: process.env.ZZZ_API_KEY,
    ZHIZENGZENG_API_KEY: process.env.ZHIZENGZENG_API_KEY
  };
  process.env.RPA_MOCK_DELAY_MS = "900";
  process.env.RPA_NEXT_POLL_MS = "300";
  process.env.YINGDAO_ACCESS_KEY_ID = "";
  process.env.YINGDAO_ACCESS_KEY_SECRET = "";
  process.env.YINGDAO_PRICE_ROBOT_UUID = "";
  process.env.YINGDAO_ACCOUNT_NAME = "";
  process.env.ZZZ_API_KEY = "";
  process.env.ZHIZENGZENG_API_KEY = "";

  const { server, url } = await startServer(workspace);
  const crawler = await listen(createCrawlerServer());
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  });

  try {
    await runPriceExtractorTests(new URL(url).origin);
    await runRpaApiTests(crawler.url);
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
    await assertLayoutShift(page);
    await page.locator("[data-pa-pickup-card]", { hasText: "已拾取" }).waitFor();
    await page.locator("[data-pa-rpa-console]", { hasText: "跨平台证据采集" }).waitFor();
    assertIncludes(await page.locator(".pa-tabs").innerText(), "证据", "assistant should expose workspace tabs");
    await page.locator('[data-pa-action="switch-panel"][data-pa-panel-target="calculator"]').click();
    assert.equal(
      await page.locator('[data-pa-field="packageWeightKg"]').isVisible(),
      true,
      "calculator tab should show freight template fields"
    );
    await page.locator('[data-pa-action="switch-panel"][data-pa-panel-target="evidence"]').click();
    assertIncludes(await page.locator("[data-pa-rpa-console]").innerText(), "网页官旗", "RPA console should show web and RPA collection sources");
    assert.equal(
      await page.evaluate(() => document.body.innerText.includes("价格爬取服务") || document.body.innerText.includes("详情图采集服务")),
      false,
      "technical service endpoints should not be visible in the assistant UI"
    );

    await page.locator('[data-pa-field="officialUrl"]').fill(`${new URL(url).origin}/demo/official-store-page.html`);
    await setCrawlerEndpoints(page, crawler.url);
    await page.locator('[data-pa-action="crawl-detail-images"]').click();
    await page.locator("[data-pa-crawl-status]", { hasText: "已采集" }).waitFor();
    const imageTableText = await page.locator("[data-pa-image-list]").innerText();
    assertIncludes(imageTableText, "网页官旗", "detail image table should keep source platform");
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
    assertIncludes(resultText, "16.92 元", "result should show freight-template suggested purchase price");
    assertIncludes(resultText, "计费重运费", "result should show freight basis");
    assertIncludes(resultText, "证据完整度", "result should show evidence completeness");
    assertIncludes(resultText, "最低凑单场景", "result should show scenario table");

    await page.locator('[data-pa-action="copy"]').click();
    const copied = await page.evaluate(() => window.__purchaseAssistantCopiedText);
    assertIncludes(copied, "审核建议", "copy should include review heading");
    assertIncludes(copied, "建议采购价：16.92 元", "copy should include freight-template suggested purchase price");
    assertIncludes(copied, "计费重运费：3.65 元", "copy should include freight cost");
    assertIncludes(copied, "计费重：1.5kg", "copy should include billed freight weight");

    const commandPage = await browser.newPage();
    await commandPage.goto(url, { waitUntil: "domcontentloaded" });
    await commandPage.addStyleTag({ path: path.join(workspace, "extension/content/sidebar.css") });
    await commandPage.addScriptTag({ path: path.join(workspace, "extension/shared/analyzer.js") });
    await commandPage.addScriptTag({ path: path.join(workspace, "extension/content/content.js") });
    await commandPage.evaluate(() => window.PurchaseAssistantUI.open());

    await commandPage.locator("#purchase-assistant-root:not(.pa-hidden)").waitFor();
    await assertLayoutShift(commandPage);
    await commandPage.locator('[data-pa-field="officialUrl"]').fill(`${new URL(url).origin}/demo/official-store-page.html`);
    await setCrawlerEndpoints(commandPage, crawler.url);
    await commandPage.locator('[data-pa-field="lowPrice"]').fill("14.2");
    await commandPage.locator('[data-pa-field="bomLow"]').fill("19");
    await commandPage.locator('[data-pa-field="bomHigh"]').fill("21");
    await commandPage.locator("[data-pa-command-input]").fill("帮我完整审核这单");
    await commandPage.locator('[data-pa-action="run-command"]').click();

    await commandPage.locator('[data-pa-risk]', { hasText: "高风险" }).waitFor();
    await commandPage.waitForFunction(() => document.querySelector('[data-pa-field="officialPrice"]')?.value === "27.99");
    const commandResultText = await commandPage.locator("[data-pa-result]").innerText();
    assertIncludes(commandResultText, "建议驳回", "natural language command should generate review result");
    assertIncludes(commandResultText, "16.92 元", "natural language command should calculate freight-template suggested purchase price");
    const decisionSummary = await commandPage.locator("[data-pa-decision-summary]").innerText();
    assertIncludes(decisionSummary, "建议驳回", "agent should show an immediate decision summary");
    assertIncludes(decisionSummary, "16.92 元", "decision summary should show freight-template suggested purchase price");
    assertIncludes(await commandPage.locator("[data-pa-command-log]").innerText(), "高风险", "agent command log should show final risk");
    assertIncludes(await commandPage.locator("[data-pa-image-state]").innerText(), "7 张", "agent command should collect per-platform image evidence");
    const commandEvidenceText = await commandPage.locator("[data-pa-rpa-evidence]").innerText();
    assertIncludes(commandEvidenceText, "抖音 RPA", "agent command should keep douyin RPA image evidence");
    assertIncludes(commandEvidenceText, "淘宝 RPA", "agent command should keep taobao RPA image evidence");

    const rpaPage = await browser.newPage();
    await rpaPage.goto(url, { waitUntil: "domcontentloaded" });
    await rpaPage.addStyleTag({ path: path.join(workspace, "extension/content/sidebar.css") });
    await rpaPage.addScriptTag({ path: path.join(workspace, "extension/shared/analyzer.js") });
    await rpaPage.addScriptTag({ path: path.join(workspace, "extension/content/content.js") });
    await rpaPage.evaluate(() => window.PurchaseAssistantUI.open());

    await rpaPage.locator("#purchase-assistant-root:not(.pa-hidden)").waitFor();
    await setCrawlerEndpoints(rpaPage, crawler.url);
    await rpaPage.locator('[data-pa-action="rpa-demo"]').first().click();

    await rpaPage.waitForFunction(() => document.querySelector('[data-pa-field="officialPrice"]')?.value === "27.99");
    await rpaPage.locator('[data-pa-risk]', { hasText: "高风险" }).waitFor();
    assertIncludes(await rpaPage.locator("[data-pa-crawl-status]").innerText(), "演示兜底识价", "RPA path should show explicit fallback evidence");
    assertIncludes(await rpaPage.locator("[data-pa-image-state]").innerText(), "7 张", "RPA path should reuse multi-platform image evidence");
    const rpaConsoleText = await rpaPage.locator("[data-pa-rpa-console]").innerText();
    assertIncludes(rpaConsoleText, "兜底入账", "RPA console should show fallback status only after waiting");
    assertIncludes(rpaConsoleText, "27.99 元", "RPA console should show collected price");
    assertIncludes(rpaConsoleText, "7 张", "RPA console should show collected image count");
    assertIncludes(rpaConsoleText, "平台图片证据包", "RPA console should show platform image evidence package");

    const primaryPage = await browser.newPage();
    await primaryPage.goto(url, { waitUntil: "domcontentloaded" });
    await primaryPage.addStyleTag({ path: path.join(workspace, "extension/content/sidebar.css") });
    await primaryPage.addScriptTag({ path: path.join(workspace, "extension/shared/analyzer.js") });
    await primaryPage.addScriptTag({ path: path.join(workspace, "extension/content/content.js") });
    await primaryPage.evaluate(() => window.PurchaseAssistantUI.open());
    await primaryPage.locator("#purchase-assistant-root:not(.pa-hidden)").waitFor();
    await setCrawlerEndpoints(primaryPage, crawler.url);
    await primaryPage.locator('[data-pa-action="analyze"]').click();
    await primaryPage.waitForFunction(() => document.querySelector('[data-pa-field="officialPrice"]')?.value === "27.99");
    await primaryPage.locator('[data-pa-risk]', { hasText: "高风险" }).waitFor();
    const primaryConsoleText = await primaryPage.locator("[data-pa-rpa-console]").innerText();
    assertIncludes(primaryConsoleText, "3/3", "primary CTA should trigger all evidence sources");
    assertIncludes(primaryConsoleText, "已获取", "primary CTA should show collected source states");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => crawler.server.close(resolve));
    Object.entries(savedEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
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

async function setCrawlerEndpoints(page, crawlerUrl) {
  await page.evaluate((baseUrl) => {
    document.querySelector('[data-pa-field="crawlerEndpoint"]').value = `${baseUrl}/api/official-price`;
    document.querySelector('[data-pa-field="detailImageEndpoint"]').value = `${baseUrl}/api/detail-images`;
  }, crawlerUrl);
}

async function assertLayoutShift(page) {
  const layout = await page.evaluate(() => {
    const hostRight = Math.max(
      ...Array.from(document.body.children)
      .filter((child) => child.id !== "purchase-assistant-root")
        .map((child) => child.getBoundingClientRect().right)
    );
    const panelLeft = document.querySelector("#purchase-assistant-root").getBoundingClientRect().left;
    return {
      hasOpenClass: document.documentElement.classList.contains("pa-layout-shift"),
      reservedWidth: window.innerWidth - panelLeft,
      hostRight,
      panelLeft
    };
  });
  assert.equal(layout.hasOpenClass, true, "opening assistant should mark page as shifted");
  assert.ok(layout.reservedWidth >= 460, "opening assistant should reserve right-side workspace");
  assert.ok(layout.hostRight <= layout.panelLeft + 1, "assistant should not cover the host page content");
}

(async () => {
  await runAnalyzerTests();
  await runBrowserTests();
  console.log("acceptance tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
