import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { put } from "@vercel/blob";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    style = "photo_caption",
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
    width = 1080,
    height = 1350,
    filename
  } = req.body || {};

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    // HTML под фото + подпись
    const html = `
      <!doctype html><html lang="ru"><head><meta charset="utf-8"/>
      <style>
        *{box-sizing:border-box}
        body{margin:0;width:${width}px;height:${height}px;background:#FAF7F2;
             font-family:-apple-system,Inter,Segoe UI,Roboto,sans-serif}
        .wrap{padding:48px;height:100%;display:flex;flex-direction:column;gap:22px}
        .card{background:#fff;border-radius:28px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
        .photo{overflow:hidden}
        .photo img{width:100%;height:100%;aspect-ratio:1/1;object-fit:cover;display:block}
        .caption{padding:28px;font-size:40px;line-height:1.2}
        .footer{display:flex;justify-content:space-between;color:#666;margin-top:auto;padding:0 8px;font-size:22px}
      </style></head>
      <body>
        <div class="wrap">
          <div class="card photo">
            ${imageUrl
              ? `<img src="${imageUrl}" alt="photo">`
              : `<div style="aspect-ratio:1/1;display:grid;place-items:center;color:#aaa">no image</div>`}
          </div>
          <div class="card caption">${caption}</div>
          <div class="footer"><div>${handle}</div><div>${pageNo}</div></div>
        </div>
      </body></html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });

    // Ждём загрузку всех <img>, чтобы не получить пустой кадр
    try {
      await page.waitForSelector("img", { timeout: 5000 });
      await page.evaluate(async () => {
        const imgs = Array.from(document.images);
        await Promise.all(imgs.map(img => img.complete ? 1 : new Promise(r => img.addEventListener("load", r, { once:true }))));
      });
    } catch (_) {}

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    // Сохраняем в Vercel Blob → отдаём ссылку
    const safeName =
      (filename && String(filename).replace(/[^\w.-]/g, "_")) ||
      `slide_${Date.now()}.png`;

    try {
      const blob = await put(safeName, png, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true
      });
      return res.status(200).json({ ok: true, mode: "blob", url: blob.url, filename: safeName });
    } catch (e) {
      // Фолбэк: data URL (на случай, если Blob не подключён)
      const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
      return res.status(200).json({ ok: true, mode: "data-url", url: dataUrl, filename: safeName, note: "Blob unavailable, returned data URL" });
    }
  } catch (err) {
    console.error("render error:", err);
    return res.status(500).json({ error: "Failed to render", detail: String(err?.message || err) });
  }
}
