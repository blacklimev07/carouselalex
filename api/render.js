import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chrome-aws-lambda";

const app = express();
app.use(express.json({ limit: "10mb" }));

app.post("/render", async (req, res) => {
  const { style, imageUrl, caption, handle, pageNo } = req.body;

  try {
    // HTML-шаблон для photo_caption
    const html = `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body {
            margin: 0;
            padding: 0;
            background: #111;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
          }
          .card {
            width: 1080px;
            height: 1350px;
            background: #FAF7F2;
            border-radius: 32px;
            padding: 40px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .photo {
            width: 100%;
            height: 70%;
            border-radius: 24px;
            overflow: hidden;
          }
          .photo img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }
          .caption {
            font-size: 40px;
            font-weight: 500;
            color: #000;
            margin-top: 20px;
          }
          .footer {
            display: flex;
            justify-content: space-between;
            font-size: 28px;
            color: #555;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="photo">
            <img src="${imageUrl}" alt="photo" />
          </div>
          <div class="caption">${caption}</div>
          <div class="footer">
            <span>${handle}</span>
            <span>${pageNo}</span>
          </div>
        </div>
      </body>
    </html>
    `;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const buffer = await page.screenshot({ type: "png" });
    await browser.close();

    res.setHeader("Content-Type", "image/png");
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Rendering failed" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
