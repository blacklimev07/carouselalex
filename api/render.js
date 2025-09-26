import chromium from "@sparticuz/chrome-aws-lambda";
import puppeteer from "puppeteer-core";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { title, body, handle, pageNo } = req.body;

  try {
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    const html = `
      <html>
        <head>
          <style>
            body { font-family: -apple-system, sans-serif; padding: 40px; background: #fdfdfd; }
            h1 { font-size: 28px; margin-bottom: 20px; }
            blockquote { border-left: 4px solid #999; padding-left: 12px; color: #555; font-style: italic; }
            footer { margin-top: 40px; font-size: 14px; color: #666; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div>${body.replace(/\n/g, "<br/>").replace(/> (.*)/g, "<blockquote>$1</blockquote>")}</div>
          <footer>${handle} • ${pageNo}</footer>
        </body>
      </html>
    `;

    await page.setContent(html, { waitUntil: "networkidle0" });
    const screenshotBuffer = await page.screenshot({ type: "png" });

    await browser.close();

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", 'inline; filename="note.png"');
    res.send(screenshotBuffer);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to render image" });
  }
}
