import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

/**
 * POST /api/render
 * Body:
 * {
 *   "style": "photo_caption",
 *   "imageUrl": "https://.../image.jpg",
 *   "caption": "Текст подписи",
 *   "handle": "@do3",
 *   "pageNo": "1/5"
 * }
 */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    style = "photo_caption",
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
    width = 1080,
    height = 1350
  } = req.body || {};

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Минимальный HTML под обложку с фото и подписью
    const html = `
      <!doctype html>
      <html lang="ru">
      <head>
        <meta charset="utf-8"/>
        <style>
          *{box-sizing:border-box}
          body{margin:0;width:${width}px;height:${height}px;
               background:#FAF7F2;font-family:-apple-system,Inter,Segoe UI,Roboto,sans-serif}
          .wrap{padding:48px;height:100%;display:flex;flex-direction:column;gap:22px}
          .card{background:#fff;border-radius:28px;box-shadow:0 10px 30px rgba(0,0,0,.06)}
          .photo{overflow:hidden}
          .photo img{width:100%;height:100%;aspect-ratio:1/1;object-fit:cover;display:block}
          .caption{padding:28px;font-size:40px;line-height:1.2}
          .footer{display:flex;justify-content:space-between;color:#666;margin-top:auto;padding:0 8px;font-size:22px}
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card photo">
            ${imageUrl
              ? `<img src="${imageUrl}" alt="photo">`
              : `<div style="aspect-ratio:1/1;display:grid;place-items:center;color:#aaa">no image</div>`}
          </div>

          <div class="card caption">${caption}</div>

          <div class="footer">
            <div>${handle}</div><div>${pageNo}</div>
          </div>
        </div>
      </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });

    // Дождаться загрузки <img>, иначе может успеть сделать скриншот до подгрузки
    try {
      await page.waitForSelector("img", { timeout: 5000 });
      await page.evaluate(async () => {
        const imgs = Array.from(document.images);
        await Promise.all(imgs.map(img => img.complete ? Promise.resolve() :
          new Promise(res => img.addEventListener('load', res, { once: true }))));
      });
    } catch (_) {
      // если картинки нет — просто идем дальше
    }

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", 'inline; filename="slide.png"');
    return res.send(png);
  } catch (err) {
    console.error("render error:", err);
    return res.status(500).json({ error: "Failed to render", detail: String(err?.message || err) });
  }
}
