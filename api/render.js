// api/render.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// безопасная строка
const safe = (s) => String(s ?? "");

// ——— HTML шаблон для фото + хук
function buildPhotoHookHTML({ imgSrc, hook, handle, pageNo }) {
  return `
    <div class="wrap">
      <div class="card" style="overflow:hidden;border-radius:32px">
        <div class="photo-bg" style="
          width:100%;
          height:620px;
          background:${imgSrc ? `url('${imgSrc}') center / cover no-repeat` : "#eee"};
          background-color:#eee;
        "></div>
      </div>

      <div class="card" style="padding:28px">
        <div style="
          font-size:54px; line-height:1.12; font-weight:800;
          letter-spacing:-.3px; text-align:center">
          ${hook}
        </div>
      </div>

      <div class="footer"><div>${handle}</div><div>${pageNo}</div></div>
    </div>
  `;
}

// ——— базовая страница
function pageHTML(inner, { width, height }) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"/>
    <style>
      *{box-sizing:border-box}
      html,body{margin:0;padding:0}
      body{
        width:${width}px;height:${height}px;background:#F7F3E8;
        font-family:-apple-system, Inter, Segoe UI, Roboto, sans-serif;color:#111;display:flex
      }
      .wrap{padding:48px;width:100%;display:flex;flex-direction:column;gap:22px}
      .card{background:#fff;border-radius:32px;box-shadow:0 16px 40px rgba(0,0,0,.06)}
      .footer{display:flex;justify-content:space-between;color:#6a6a6a;font-size:22px;padding:0 6px;margin-top:auto}
    </style>
  </head><body>${inner}</body></html>`;
}

// ——— основной handler
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const {
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
  } = req.body || {};

  try {
    const width = 1080;
    const height = 1350;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // собираем HTML
    const html = pageHTML(
      buildPhotoHookHTML({
        imgSrc: safe(imageUrl),
        hook: safe(caption),
        handle: safe(handle),
        pageNo: safe(pageNo),
      }),
      { width, height }
    );

    await page.setContent(html, { waitUntil: "networkidle0" });

    // ——— ждём пока фон реально применится
    await page.waitForSelector(".photo-bg", { timeout: 5000 });
    await page.waitForFunction(() => {
      const el = document.querySelector(".photo-bg");
      if (!el) return false;
      const bg = getComputedStyle(el).backgroundImage;
      return bg && bg !== "none";
    }, { timeout: 5000 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    // возвращаем dataURL
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    return res.status(200).json({
      ok: true,
      width,
      height,
      dataUrl,
    });
  } catch (e) {
    console.error("render error:", e);
    return res.status(500).json({
      ok: false,
      error: "Failed to render",
      detail: String(e?.message || e),
    });
  }
}
