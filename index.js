require("dotenv").config();
const express = require("express");
const wishlistRouter = require("./src/routes/wishlist");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

app.get("/", (req, res) => res.send("Wishlist app running"));

// Shopify me /apps/wishlist/items  ->  yahan /proxy/items
app.use("/proxy", wishlistRouter);

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
