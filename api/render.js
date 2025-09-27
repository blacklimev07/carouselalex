// api/render.js — Vercel serverless, returns JSON { ok, dataUrl } for "photo + hook"
// Параметры body:
// {
//   "imageUrl": "https://...",
//   "caption": "Жирный ХУК по центру",
//   "handle": "@do3",
//   "pageNo": "1/5",
//   "fit": "contain" | "cover",        // опционально, default: "contain"
//   "photoHeight": 620,                 // опционально, px
//   "width": 1080, "height": 1350      // опционально
// }

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// ——— utils
const safe = (s) => String(s ?? "");

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

    // Google Drive: .../file/d/<id>/view -> uc?export=download&id=<id>
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

// Качаем файл на сервере и конвертируем в data:URL (обход CORS/hotlink)
async function fetchToDataUrl(url) {
  if (!url) return null;
  const norm = normalizeImageUrl(url);
  try {
    const resp = await fetch(norm, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
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

    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch (e) {
    console.error("fetchToDataUrl error for", norm, e);
    return null;
  }
}

// ——— шаблон: Фото + жирный хук по центру
function buildPhotoHookHTML({ imgSrc, hook, handle, pageNo, photoHeight = 620, fit = "contain" }) {
  // cover = может подрезать края, contain = вся фотка целиком (могут быть поля)
  const bgSize = fit === "cover" ? "cover" : "contain";
  return `
    <div class="wrap">
      <!-- Фото фоном, фикс-высота -->
      <div class="card" style="overflow:hidden;border-radius:32px">
        <div style="
          width:100%;
          height:${photoHeight}px;
          background:${imgSrc ? `url('${imgSrc}') center / ${bgSize} no-repeat` : "#eee"};
          background-color:#eee; /* фон под полями при contain */
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

// ——— базовый каркас страницы
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
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
    fit = "contain",          // "contain" | "cover"
    photoHeight = 620,        // px
    width = 1080,
    height = 1350,
  } = req.body || {};

  try {
    // заранее тянем картинку как data:URL (надежно для Dropbox/Drive)
    const imgData = imageUrl ? await fetchToDataUrl(imageUrl) : null;

    const html = pageHTML({
      width,
      height,
      inner: buildPhotoHookHTML({
        imgSrc: imgData || normalizeImageUrl(imageUrl),
        hook: safe(caption),
        handle: safe(handle),
        pageNo: safe(pageNo),
        photoHeight: Number(photoHeight) || 620,
        fit: fit === "cover" ? "cover" : "contain",
      }),
    });

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width, height, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // картинка у нас уже data:, так что ждать <img> не нужно

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
    return res.status(200).json({
      ok: true,
      width,
      height,
      dataUrl,
      // debug:
      // used: imgData ? "data:" : normalizeImageUrl(imageUrl)
    });
  } catch (e) {
    console.error("render error:", e);
    return res.status(500).json({ ok: false, error: "Failed to render", detail: String(e?.message || e) });
  }
}
