import express from "express";
import path from "node:path";
import { config } from "./config";
import productsRouter from "./routes/products";
import transactionsRouter from "./routes/transactions";
import { errorHandler, notFoundHandler } from "./middleware/errors";

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));
app.use("/api/products", productsRouter);
app.use("/api/transactions", transactionsRouter);
app.use(notFoundHandler);
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`Stokaman berjalan di http://localhost:${config.port}`);
});
