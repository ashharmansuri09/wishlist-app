require("dotenv").config();
const express = require("express");
const { verifyProxy } = require("./src/middleware/verifyProxy");
const wishlistRouter = require("./src/routes/wishlist");
const { router: alertsRouter } = require("./src/routes/alerts");
const { router: webhooksRouter } = require("./src/routes/webhooks");

const app = express();
app.disable("x-powered-by");

// Webhooks pehle: inhe RAW body chahiye (signature ke liye), isliye express.json() se PEHLE mount hote hain
app.use("/webhooks", webhooksRouter);

app.use(express.json({ limit: "10kb" }));

app.get("/", (req, res) => res.send("Wishlist app running"));

// App Proxy: Shopify me /apps/wishlist/xyz  ->  yahan /proxy/xyz
// Is router ke har route par pehle Shopify signature check hota hai.
const proxy = express.Router();
proxy.use((req, res, next) => {
  res.set("Cache-Control", "no-store"); // har response fresh ho
  next();
});
proxy.use(verifyProxy);
proxy.use(wishlistRouter); // /items, /add, /remove, /merge
proxy.use(alertsRouter);   // /notify, /unsubscribe
app.use("/proxy", proxy);

app.use((req, res) => res.status(404).json({ ok: false, error: "not_found" }));

// Kharab JSON body etc.
app.use((err, req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "invalid_json" });
  }
  console.error(err);
  res.status(500).json({ ok: false, error: "server_error" });
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Running on http://localhost:${port}`));
}
