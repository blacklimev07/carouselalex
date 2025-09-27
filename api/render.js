import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

const md = new MarkdownIt({ html: false, breaks: true, typographer: true });

// универсальный шаблон PHOTO + HOOK
function tplPhotoHook({ imgSrc, hook, handle, pageNo }) {
  return {
    width: 1080,
    height: 1350,
    html: `
      <div class="wrap">
        <div class="card" style="overflow:hidden;border-radius:32px">
          <div style="
            width:100%;
            height:620px;
            background:${imgSrc ? `url('${imgSrc}') center / cover no-repeat` : "#eee"};
          "></div>
        </div>

        <div class="card" style="padding:28px">
          <div style="
            font-size:54px;
            line-height:1.12;
            font-weight:800;
            letter-spacing:-.3px;
            text-align:center;
          ">
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
    style = "photo_caption",
    imageUrl = "",
    caption = "",
    handle = "@anon",
    pageNo = "1/1"
  } = req.body || {};

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: 1080, height: 1350, deviceScaleFactor: 2 },
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();

    let tpl;
    if (style === "photo_caption") {
      tpl = tplPhotoHook({
        imgSrc: imageUrl,
        hook: sanitizeHtml(caption),
        handle,
        pageNo
      });
    } else {
      throw new Error(`Unknown style: ${style}`);
    }

    const html = `
      <!doctype html>
      <html lang="ru">
      <head>
        <meta charset="utf-8"/>
        <style>
          body {
            margin:0;
            background:#fbf7ea;
            font-family:-apple-system, Inter, system-ui, Segoe UI, Roboto, sans-serif;
            display:flex;
            justify-content:center;
            align-items:center;
            width:${tpl.width}px;
            height:${tpl.height}px;
          }
          .wrap {
            width:100%;
            height:100%;
            padding:48px;
            display:flex;
            flex-direction:column;
            justify-content:space-between;
            box-sizing:border-box;
          }
          .card {
            background:#fff;
            border-radius:32px;
            box-shadow:0 4px 20px rgba(0,0,0,.08);
          }
          .footer {
            font-size:24px;
            color:#666;
            display:flex;
            justify-content:space-between;
            padding:8px 4px 0;
          }
        </style>
      </head>
      <body>${tpl.html}</body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });
    const buffer = await page.screenshot({ type: "png" });
    await browser.close();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", 'inline; filename="note.png"');
    return res.send(buffer);
  } catch (err) {
    console.error("Renderer error:", err);
    res.status(500).json({ error: "Failed to render image", detail: String(err) });
  }
}
