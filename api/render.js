import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { put } from "@vercel/blob";

// --- helper: безопасное имя файла
const safeName = (s) => (s ? String(s).replace(/[^\w.-]/g, "_") : "");

// --- helper: привести dropbox ссылку к «сырой»
function normalizeImageUrl(u = "") {
  try {
    const url = new URL(u);
    // Dropbox preview -> raw
    if (url.hostname.includes("dropbox.com")) {
      url.hostname = "dl.dropboxusercontent.com";
      url.searchParams.set("raw", "1"); // на всякий случай
      url.searchParams.delete("dl");
      return url.toString();
    }
    return u;
  } catch {
    return u;
  }
}

// --- helper: скачать файл на сервере и превратить в data:URL (обходит CORS)
async function fetchToDataUrl(url) {
  if (!url) return null;
  const norm = normalizeImageUrl(url);
  try {
    const resp = await fetch(norm);
    if (!resp.ok) throw new Error(`IMG ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());

    // грубая эвристика по расширению/контент-тайпу
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
    console.error("fetchToDataUrl error:", e);
    return null;
  }
}

// --- базовый CSS
function baseCSS({ width, height }) {
  return `
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{
      width:${width}px;height:${height}px;background:#F7F3E8;
      font-family:-apple-system, Inter, Segoe UI, Roboto, sans-serif;color:#111;display:flex
    }
    .wrap{padding:48px;width:100%;display:flex;flex-direction:column;gap:22px}
    .card{background:#fff;border-radius:32px;box-shadow:0 16px 40px rgba(0,0,0,.06)}
    .footer{display:flex;justify-content:space-between;color:#6a6a6a;font-size:22px;padding:0 6px;margin-top:auto}
  `;
}

// --- шаблон: NOTES COVER (жирный хук)
function tplNotesCover({ hook, handle, pageNo }) {
  return {
    width: 1080,
    height: 1350,
    html: `
      <div class="wrap">
        <div class="card" style="height:800px;display:flex;flex-direction:column">
          <div style="height:82px;display:flex;align-items:center;padding:0 28px;border-bottom:1px solid rgba(0,0,0,.06);background:linear-gradient(#fff,#FDFCF9)">
            <div style="font-size:36px;font-weight:800;color:#D4A100">Заметки</div>
          </div>
          <div style="flex:1;background:#fff;border-radius:0 0 32px 32px"></div>
        </div>

        <div class="card" style="padding:28px">
          <div style="font-size:54px;line-height:1.12;font-weight:800;letter-spacing:-.3px;text-align:center">
            ${hook}
          </div>
        </div>

        <div class="footer"><div>${handle}</div><div>${pageNo}</div></div>
      </div>
    `
  };
}

// --- шаблон: PHOTO + HOOK (фото 16:10, центрированный жирный хук)
function tplPhotoHook({ imgSrc, hook, handle, pageNo }) {
  return {
    width: 1080,
    height: 1350,
    html: `
      <div class="wrap">
        <div class="card" style="overflow:hidden">
          ${
            imgSrc
              ? `<img src="${imgSrc}" alt="" style="width:100%;aspect-ratio:16/10;object-fit:cover;display:block">`
              : `<div style="width:100%;aspect-ratio:16/10;display:grid;place-items:center;color:#aaa">no image</div>`
          }
        </div>

        <div class="card" style="padding:28px">
          <div style="font-size:54px;line-height:1.12;font-weight:800;letter-spacing:-.3px;text-align:center">
            ${hook}
          </div>
        </div>

        <div class="footer"><div>${handle}</div><div>${pageNo}</div></div>
      </div>
    `
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const {
    style = "notes_cover",          // "notes_cover" | "photo_caption"
    imageUrl = "",
    caption = "",
    handle = "@do3",
    pageNo = "1/5",
    width,
    height,
    filename
  } = req.body || {};

  // выбрать шаблон
  const usePhoto = style === "photo_caption";
  const tpl = usePhoto ? tplPhotoHook : tplNotesCover;

  // размеры по умолчанию из шаблона
  const view0 = tpl({ imgSrc: "", hook: caption, handle, pageNo });
  const W = Number(width) || view0.width;
  const H = Number(height) || view0.height;

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: W, height: H, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    // серверная подгрузка картинки → data:URL
    const imgDataUrl = usePhoto && imageUrl ? await fetchToDataUrl(imageUrl) : null;

    const html = `
      <!doctype html><html lang="ru"><head><meta charset="utf-8"/>
      <style>${baseCSS({ width: W, height: H })}</style></head>
      <body>
        ${
          (usePhoto
            ? tplPhotoHook({ imgSrc: imgDataUrl || normalizeImageUrl(imageUrl), hook: caption, handle, pageNo })
            : tplNotesCover({ hook: caption, handle, pageNo })
          ).html
        }
      </body></html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });

    // ждём возможные <img>
    try {
      await page.waitForSelector("img", { timeout: 4000 });
      await page.evaluate(async () => {
        const imgs = Array.from(document.images);
        await Promise.all(imgs.map(img => img.complete ? 1 : new Promise(r => img.addEventListener("load", r, { once:true }))));
      });
    } catch {}

    const png = await page.screenshot({ type: "png" });
    await browser.close();

    // заливаем в Blob и возвращаем ссылку
    const name = safeName(filename) || `slide_${Date.now()}.png`;
    try {
      const blob = await put(name, png, {
        access: "public",
        contentType: "image/png",
        addRandomSuffix: true
      });
      return res.status(200).json({ ok: true, style, url: blob.url, filename: name });
    } catch {
      const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
      return res.status(200).json({ ok: true, style, mode: "data-url", url: dataUrl, filename: name });
    }
  } catch (e) {
    console.error("render error:", e);
    return res.status(500).json({ ok: false, error: "Failed to render", detail: String(e?.message || e) });
  }
}
