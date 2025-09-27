// api/render.js — Vercel serverless, returns JSON { ok, dataUrl }
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// ——— utils
const safe = (s) => String(s ?? "");
const safeName = (s) => (s ? String(s).replace(/[^\w.-]/g, "_") : "");

// Приводим ссылки Dropbox/Drive к «сырым»
function normalizeImageUrl(u = "") {
  try {
    const url = new URL(u);

    // Dropbox preview -> raw
    if (url.hostname.includes("dropbox.com")) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.set("raw", "1");
      url.searchParams.delete("dl");
      return url.toString();
    }

    // Google Drive: .../file/d/<id>/view  ->  uc?export=download&id=<id>
    if (url.hostname.includes("drive.google.com")) {
      const m = u.match(/\/d\/([^/]+)\//);
      if (m && m[1]) {
        return `https://drive.google.com/uc?export=download&id=${m[1]}`;
      }
    }

    return u;
  } catch {
    return u;
  }
}

// Скачиваем картинку на сервере и конвертируем в data:URL (обход CORS/hotlink)
async function fetchToDataUrl(url) {
  if (!url) return null;
  const norm = normalizeImageUrl(url);
  try {
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
    const ab = await resp.arrayBuffer();
    const buf = Buffer.from(ab);

    let mime =
      resp.headers.get("content-type") ||
      (/\.(png)(\?|$)/i.test(norm)
        ? "image/png"
        : /\.(webp)(\?|$)/i.test(norm)
        ? "image/webp"
        : "image/jpeg");

    const b64 = buf.toString("base64");
    return `data:${mime};base64,${b64}`;
  } catch (e) {
    console.error("fetchToDataUrl error for", norm, e);
    return null;
  }
}

// ——— шаблон «Фото + жирный хук по центру»
function tplPhotoHook({ imgSrc, hook, handle, pageNo }) {
  return {
    width: 1080,
    height: 1350,
    html: `
      <div class="wrap">
        <!-- Фото как background-image, фикс-высота, чтобы не резалось -->
        <div class="card" style="overflow:hidden;border-radius:32px">
          <div style="
            width:100%;
            height:620px;
            background:${imgSrc ? `url('${imgSrc}') center / cover no-repeat` : "#eee"};
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
    `,
  };
}

// ——— базовый CSS и страница
function pageHTML({ width, height, inner }) {
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

// ——— Vercel handler
export default async function handler(req, res) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const {
    // входные данные
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
  } = req.body || {};

  try {
    // готовим шаблон
    const view = tplPhotoHook({
      imgSrc: "", // подставим после загрузки
      hook: safe(caption),
      handle: safe(handle),
      pageNo: safe(pageNo),
    });

    // запускаем браузер
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: view.width, height: view.height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // пробуем подгрузить картинку на сервере → dataURL
    const imgData = imageUrl ? await fetchToDataUrl(imageUrl) : null;
    const html = pageHTML({
      width: view.width,
      height: view.height,
      inner: tplPhotoHook({
        imgSrc: imgData || normalizeImageUrl(imageUrl),
        hook: safe(caption),
        handle: safe(handle),
        pageNo: safe(pageNo),
      }).html,
    });

    await page.setContent(html, { waitUntil: "networkidle0" });

    // дождёмся возможного <img> (если dataURL не получился и стоит прямой URL)
    try {
      await page.waitForSelector("img", { timeout: 3000 });
      await page.evaluate(async () => {
        const imgs = Array.from(document.images);
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? 1
              : new Promise((r) => img.addEventListener("load", r, { once: true }))
          )
        );
      });
    } catch {}

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    // Возвращаем JSON с dataURL (НЕ бинарь)
    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    return res.status(200).json({
      ok: true,
      width: view.width,
      height: view.height,
      dataUrl,
    });
  } catch (e) {
    console.error("render error:", e);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to render", detail: String(e?.message || e) });
  }
}
