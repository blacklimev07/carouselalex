// api/render.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const safe = (s) => String(s ?? "");

// raw-ссылки для Dropbox/Drive
function normalizeImageUrl(u = "") {
  try {
    const url = new URL(u);
    if (url.hostname.includes("dropbox.com")) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.set("raw", "1");
      url.searchParams.delete("dl");
      return url.toString();
    }
    if (url.hostname.includes("drive.google.com")) {
      const m = u.match(/\/d\/([^/]+)\//);
      if (m && m[1]) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
    }
    return u;
  } catch {
    return u;
  }
}

async function fetchToDataUrl(url) {
  if (!url) return null;
  const norm = normalizeImageUrl(url);
  const resp = await fetch(norm, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    redirect: "follow",
    cache: "no-store",
  });
  if (!resp.ok) throw new Error(`IMG ${resp.status} ${resp.statusText}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  const ct =
    resp.headers.get("content-type") ||
    (/\.(png)(\?|$)/i.test(norm) ? "image/png" :
     /\.(webp)(\?|$)/i.test(norm) ? "image/webp" : "image/jpeg");
  return `data:${ct};base64,${buf.toString("base64")}`;
}

function buildHTML({ imgSrc, hook, handle, pageNo, photoHeight = 720, fit = "contain", width = 1080, height = 1350 }) {
  const objectFit = fit === "cover" ? "cover" : "contain";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/>
    <style>
      *{box-sizing:border-box} html,body{margin:0;padding:0}
      body{width:${width}px;height:${height}px;background:#F7F3E8;font-family:-apple-system,Inter,Segoe UI,Roboto,sans-serif;color:#111;display:flex}
      .wrap{padding:48px;width:100%;display:flex;flex-direction:column;gap:22px}
      .card{background:#fff;border-radius:32px;box-shadow:0 16px 40px rgba(0,0,0,.06)}
      .photo-box{width:100%;height:${photoHeight}px;border-radius:32px;overflow:hidden}
      .photo{width:100%;height:100%;object-fit:${objectFit};display:block}
      .caption{font-size:54px;line-height:1.12;font-weight:800;letter-spacing:-.3px;text-align:center}
      .footer{display:flex;justify-content:space-between;color:#6a6a6a;font-size:22px;padding:0 6px;margin-top:auto}
    </style></head><body>
      <div class="wrap">
        <div class="card"><div class="photo-box"><img class="photo" src="${imgSrc || ""}" alt=""></div></div>
        <div class="card" style="padding:28px"><div class="caption">${hook}</div></div>
        <div class="footer"><div>${handle}</div><div>${pageNo}</div></div>
      </div>
    </body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
    fit = "contain",
    photoHeight = 720,
    width = 1080,
    height = 1350,
    return: retMode // "binary" | "dataUrl"
  } = req.body || {};
  const binary = retMode === "binary" || req.query.binary === "1";

  try {
    // картинку тянем заранее -> data:
    const imgData = imageUrl ? await fetchToDataUrl(imageUrl) : null;
    const html = buildHTML({
      imgSrc: imgData || normalizeImageUrl(imageUrl),
      hook: safe(caption), handle: safe(handle), pageNo: safe(pageNo),
      photoHeight: Number(photoHeight) || 720, fit, width, height
    });

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // гарантированно дождёмся загрузки <img>
    await page.waitForSelector("img.photo", { timeout: 6000 }).catch(() => {});
    await page.evaluate(() => new Promise((resolve) => {
      const img = document.querySelector("img.photo");
      if (!img) return resolve();
      if (img.complete) return requestAnimationFrame(() => requestAnimationFrame(resolve));
      img.addEventListener("load", () => requestAnimationFrame(() => requestAnimationFrame(resolve)), { once: true });
      img.addEventListener("error", resolve, { once: true });
    }));

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    if (binary) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Disposition", 'attachment; filename="slide.png"');
      return res.send(png);
    }

    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    return res.status(200).json({ ok: true, width, height, dataUrl });
  } catch (e) {
    console.error("render error:", e);
    return res.status(500).json({ ok: false, error: "Failed to render", detail: String(e?.message || e) });
  }
}
